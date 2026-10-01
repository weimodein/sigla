"""
HTTP protocol shared by scripts/import_words.py and scripts/import_alphabets.py.

POST /words/:id/upload-videos answers 202 and extracts in the BACKGROUND,
refusing a second concurrent batch for the same word with 409. So: one request
per (word, signer) with every clip in it, then wait for that job to leave
'processing' before the next batch for the same word. A per-clip loop gets 409
on everything after the first and loses it silently.
"""
from __future__ import annotations

import os
import sys
import time

import httpx

# The server caps a batch here (multer's videoUpload.array("videos", 50)).
MAX_FILES_PER_BATCH = 50


class BackendImporter:
    def __init__(self, backend_url: str, admin_token: str, *,
                 job_timeout_seconds: int, upload_timeout_seconds: float,
                 job_poll_seconds: float = 5):
        self.backend_url = backend_url
        self.admin_token = admin_token
        self.job_timeout_seconds = job_timeout_seconds
        self.upload_timeout_seconds = upload_timeout_seconds
        self.job_poll_seconds = job_poll_seconds

    def headers(self) -> dict:
        if not self.admin_token:
            sys.exit("ADMIN_TOKEN is not set — needs a JWT for an admin user.")
        return {"Authorization": f"Bearer {self.admin_token}"}

    def find_or_create_word(self, client: httpx.Client, payload: dict) -> int:
        """Word id for payload["label"], creating it if the backend has none.

        adminAddWord answers 409 with the existing word_id when the label is
        taken, so a re-run reuses the word instead of duplicating it.
        """
        label = payload["label"]
        r = client.post(f"{self.backend_url}/words/admin-add",
                        headers=self.headers(), json=payload, timeout=30.0)
        if r.status_code in (200, 201):
            body = r.json()
            wid = body.get("word", {}).get("id") or body.get("id") or body.get("word_id")
            if wid is None:
                sys.exit(f"created {label} but could not find its id in {body}")
            return int(wid)
        if r.status_code == 409:
            wid = r.json().get("word_id")
            if wid is None:
                sys.exit(f"{label} exists but the 409 body carried no word_id: {r.text}")
            return int(wid)
        sys.exit(f"creating word {label} failed: {r.status_code} {r.text}")

    def stored_per_signer(self, client: httpx.Client, word_id: int) -> dict[str, int]:
        """How many samples each session_id already has stored for this word.

        Counts rather than presence: an interrupted batch leaves a PARTIAL one,
        and treating "signer appears at all" as done would abandon the rest.
        """
        r = client.get(f"{self.backend_url}/words/{word_id}/samples",
                       headers=self.headers(), timeout=120.0)
        if r.status_code != 200:
            return {}
        body = r.json()
        rows = body.get("samples", body if isinstance(body, list) else [])
        counts: dict[str, int] = {}
        for s in rows:
            if isinstance(s, dict):
                sid = s.get("session_id")
                counts[sid] = counts.get(sid, 0) + 1
        return counts

    def wait_for_job(self, client: httpx.Client, job_id: int, label: str, signer: str) -> dict:
        """Block until a job leaves 'processing'; returns the final job row."""
        deadline = time.time() + self.job_timeout_seconds
        while time.time() < deadline:
            time.sleep(self.job_poll_seconds)
            # A dropped connection is not a failed import. The job runs on the
            # SERVER, detached from this request, so losing the socket only costs
            # the status update. Letting the transport error propagate once killed
            # a whole run on its first batch while the backend finished it alone.
            try:
                r = client.get(f"{self.backend_url}/words/upload-jobs/{job_id}",
                               headers=self.headers(), timeout=30.0)
            except httpx.HTTPError as e:
                print(f"    poll dropped ({type(e).__name__}); retrying")
                continue
            if r.status_code != 200:
                print(f"    poll failed ({r.status_code}); retrying")
                continue
            job = r.json().get("job", r.json())
            status = job.get("status")
            if status and status != "processing":
                return job
            done = job.get("processed_count") or job.get("success_count") or 0
            total = job.get("total_count") or "?"
            print(f"    {label}/{signer}: {done}/{total} …", end="\r", flush=True)
        return {"status": "timeout", "job_id": job_id}

    def upload_batch(self, client: httpx.Client, word_id: int, label: str,
                     signer: str, clips: list[str]) -> dict:
        """One (word, signer) batch, then wait for its job to finish.

        Waits out any job already live for this word first: an interrupted
        earlier run, or an upload started in the admin UI, leaves one that must
        finish before the word accepts more.
        """
        live = client.get(f"{self.backend_url}/words/{word_id}/upload-jobs/active",
                          headers=self.headers(), timeout=30.0)
        if live.status_code == 200:
            job = (live.json() or {}).get("job")
            if job and job.get("status") == "processing":
                print(f"    a job is already live for {label}; waiting for it")
                self.wait_for_job(client, job["id"], label, job.get("session_id", "?"))

        if len(clips) > MAX_FILES_PER_BATCH:
            sys.exit(f"{label}/{signer} has {len(clips)} clips; the server caps a "
                     f"batch at {MAX_FILES_PER_BATCH}")

        files = []
        handles = []
        try:
            for p in clips:
                fh = open(p, "rb")
                handles.append(fh)
                files.append(("videos", (os.path.basename(p), fh, "video/quicktime")))
            try:
                r = client.post(
                    f"{self.backend_url}/words/{word_id}/upload-videos",
                    headers=self.headers(),
                    data={"session_id": signer},
                    files=files,
                    timeout=self.upload_timeout_seconds,
                )
            except httpx.HTTPError as e:
                # Deliberately NOT retried. The server may already have accepted
                # the batch, so re-POSTing risks a second job for the same clips.
                # Re-running picks up from the live job instead.
                return {"status": "transport-error", "detail": f"{type(e).__name__}: {e}"}
        finally:
            for fh in handles:
                fh.close()

        if r.status_code == 409:
            # Someone else's batch is live for this word — not recoverable here,
            # and continuing would interleave two jobs on the same counters.
            return {"status": "conflict", "detail": r.json()}
        if r.status_code != 202:
            return {"status": "error", "code": r.status_code, "detail": r.text[:300]}

        job = r.json().get("job", {})
        job_id = job.get("id")
        if job_id is None:
            return {"status": "error", "detail": f"202 without a job id: {r.text[:200]}"}
        return self.wait_for_job(client, job_id, label, signer)
