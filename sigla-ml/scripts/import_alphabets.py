"""
Import ALPHABETS clips into the backend, one batch per (letter, signer).

Layout expected on disk:

    datasets/ALPHABETS/<LETTER>/<signer-id>/*.MOV

Each (letter, signer) folder becomes ONE upload batch. That shape is not
incidental:

  * POST /words/:id/upload-videos takes at most 50 files (multer's
    videoUpload.array("videos", 50)), and a folder holds ~10.
  * session_id is REQUIRED and is the signer grouping key for cross-validation.
    Sending the wrong one silently ruins new-signer CV, because the same person
    then appears in both train and test. The folder name IS the signer id, so it
    is passed through rather than generated.
  * The endpoint answers 202 and extracts in the BACKGROUND, and refuses a second
    concurrent batch for the same word with 409. So batches for one letter must
    run one at a time, waiting for each job to reach a terminal state. A naive
    per-clip loop gets 409 on everything after the first and loses it silently —
    this script exists mostly to make that impossible.

Usage:

    # what would happen, no requests that change anything
    python scripts/import_alphabets.py --letters M T W F S --dry-run

    # real import of the five letters that collide with day signs
    python scripts/import_alphabets.py --letters M T W F S

    # everything present on disk
    python scripts/import_alphabets.py --all

Needs ADMIN_TOKEN (a JWT for an admin user) and, optionally, BACKEND_URL.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import httpx


BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080/api")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

DATASET_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "datasets", "ALPHABETS",
)

# The server caps a batch here; keep the client honest rather than discovering it
# as a 400 halfway through a run.
MAX_FILES_PER_BATCH = 50

# A batch is ~10 clips and each takes roughly 10s of MediaPipe, so a couple of
# minutes is normal and a stall is the abnormal case worth surfacing.
JOB_POLL_SECONDS = 5
JOB_TIMEOUT_SECONDS = int(os.getenv("IMPORT_JOB_TIMEOUT", 1200))

CATEGORY = os.getenv("ALPHABET_CATEGORY", "ALPHABET")


def _headers() -> dict:
    if not ADMIN_TOKEN:
        sys.exit("ADMIN_TOKEN is not set — needs a JWT for an admin user.")
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


def discover(letters: list[str] | None) -> dict[str, dict[str, list[str]]]:
    """{LETTER: {signer: [clip paths]}} for what is actually on disk."""
    if not os.path.isdir(DATASET_DIR):
        sys.exit(f"dataset folder not found: {DATASET_DIR}")
    out: dict[str, dict[str, list[str]]] = {}
    wanted = {l.upper() for l in letters} if letters else None
    for letter in sorted(os.listdir(DATASET_DIR)):
        lpath = os.path.join(DATASET_DIR, letter)
        if not os.path.isdir(lpath):
            continue
        if wanted is not None and letter.upper() not in wanted:
            continue
        signers: dict[str, list[str]] = {}
        for signer in sorted(os.listdir(lpath)):
            spath = os.path.join(lpath, signer)
            if not os.path.isdir(spath):
                continue
            clips = [
                os.path.join(spath, f)
                for f in sorted(os.listdir(spath))
                if f.lower().endswith((".mov", ".mp4", ".avi", ".mkv"))
            ]
            if clips:
                signers[signer] = clips
        if signers:
            out[letter] = signers
    return out


def find_or_create_word(client: httpx.Client, label: str) -> int:
    """Word id for `label`, creating it if the backend does not have one.

    adminAddWord answers 409 with the existing word_id when the label is already
    taken, so a re-run of this script is safe and reuses the same word rather
    than erroring or duplicating.
    """
    r = client.post(
        f"{BACKEND_URL}/words/admin-add",
        headers=_headers(),
        json={
            "label": label,
            "sign_type": "FSL",
            "category": CATEGORY,
            "description": f"FSL fingerspelling letter {label}",
            # Marks the word as belonging to the alphabet model rather than the
            # main vocabulary. Stated explicitly rather than left to the backend
            # to infer from the label: FSL's NG is a single letter spelled with
            # two characters, so no spelling rule can classify the alphabet
            # correctly on its own.
            "vocabulary": "letters",
        },
        timeout=30.0,
    )
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


def wait_for_job(client: httpx.Client, job_id: int, label: str, signer: str) -> dict:
    """Block until a job leaves 'processing'.

    Returns the final job row. Waiting is not optional: starting the next batch
    for the same word while this one is live earns a 409 and drops the clips.
    """
    deadline = time.time() + JOB_TIMEOUT_SECONDS
    while time.time() < deadline:
        time.sleep(JOB_POLL_SECONDS)
        # A dropped connection here is not a failed import. The job runs on the
        # SERVER, detached from this request, so losing the socket only costs us
        # the status update — the extraction carries on regardless. Letting the
        # transport error propagate killed a 16-batch run on its first batch
        # while the backend happily finished that batch alone, so treat it the
        # same as a non-200: say so, and poll again.
        try:
            r = client.get(
                f"{BACKEND_URL}/words/upload-jobs/{job_id}",
                headers=_headers(), timeout=30.0,
            )
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


def stored_per_signer(client: httpx.Client, word_id: int) -> dict[str, int]:
    """How many samples each session_id already has stored for this word.

    Makes a re-run resumable: a batch already stored is skipped rather than
    uploaded twice, and duplicate rows are exactly the damage that is tedious to
    find afterwards.

    Counts rather than presence, because a crashed run leaves PARTIAL batches —
    the first attempt died with 5 of 10 clips stored. Treating "signer appears
    at all" as done would silently abandon the other half.
    """
    r = client.get(f"{BACKEND_URL}/words/{word_id}/samples",
                   headers=_headers(), timeout=60.0)
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


def upload_batch(client: httpx.Client, word_id: int, label: str,
                 signer: str, clips: list[str]) -> dict:
    """One (letter, signer) batch, then wait for its job to finish.

    Waits out any job already live for this word first. The endpoint answers 409
    while one is processing, so a crashed earlier run leaves a job that must
    finish before this word accepts anything more.
    """
    live = client.get(f"{BACKEND_URL}/words/{word_id}/upload-jobs/active",
                      headers=_headers(), timeout=30.0)
    if live.status_code == 200:
        job = (live.json() or {}).get("job")
        if job and job.get("status") == "processing":
            print(f"    a job is already live for {label}; waiting for it")
            wait_for_job(client, job["id"], label, job.get("session_id", "?"))

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
                f"{BACKEND_URL}/words/{word_id}/upload-videos",
                headers=_headers(),
                data={"session_id": signer},
                files=files,
                timeout=300.0,
            )
        except httpx.HTTPError as e:
            # Deliberately NOT retried. The server may already have accepted the
            # batch and started extracting, so re-POSTing risks a second job for
            # the same clips. Report it and let the caller re-run, which picks up
            # from the live job rather than duplicating it.
            return {"status": "transport-error", "detail": f"{type(e).__name__}: {e}"}
    finally:
        for fh in handles:
            fh.close()

    if r.status_code == 409:
        # Someone else's batch is live for this word — not recoverable here, and
        # continuing would interleave two jobs on the same counters.
        return {"status": "conflict", "detail": r.json()}
    if r.status_code != 202:
        return {"status": "error", "code": r.status_code, "detail": r.text[:300]}

    job = r.json().get("job", {})
    job_id = job.get("id")
    if job_id is None:
        return {"status": "error", "detail": f"202 without a job id: {r.text[:200]}"}
    return wait_for_job(client, job_id, label, signer)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--letters", nargs="+", help="e.g. M T W F S")
    g.add_argument("--all", action="store_true", help="every letter on disk")
    ap.add_argument("--dry-run", action="store_true",
                    help="show the plan; make no changes")
    ap.add_argument("--json", metavar="PATH", help="write a per-batch report")
    args = ap.parse_args()

    found = discover(None if args.all else args.letters)
    if not found:
        sys.exit("nothing to import — check --letters against the folder names")

    n_batches = sum(len(s) for s in found.values())
    n_clips = sum(len(c) for s in found.values() for c in s.values())
    print(f"{len(found)} letters, {n_batches} batches, {n_clips} clips")
    for letter, signers in found.items():
        detail = "  ".join(f"{s}={len(c)}" for s, c in signers.items())
        print(f"  {letter}: {detail}")

    if args.dry_run:
        print("\ndry run — nothing sent.")
        return 0

    if args.all:
        # The full alphabet is a much larger commitment than a targeted check,
        # and it is easy to reach for by reflex. Make it deliberate.
        reply = input(f"\nImport all {n_clips} clips across {len(found)} letters? [y/N] ")
        if reply.strip().lower() != "y":
            print("aborted.")
            return 1

    report: dict[str, dict] = {}
    with httpx.Client() as client:
        for letter, signers in found.items():
            word_id = find_or_create_word(client, letter)
            print(f"\n{letter} (word_id {word_id})")
            report[letter] = {"word_id": word_id, "batches": {}}
            already = stored_per_signer(client, word_id)
            for signer, clips in signers.items():
                # Some clips are legitimately rejected by the quality gates, so a
                # complete batch is not always len(clips) rows. Anything within a
                # couple of rows is treated as done; a badly short one is not,
                # since that is what a crashed batch looks like.
                have = already.get(signer, 0)
                if have >= len(clips) - 2:
                    print(f"  {signer}: {have} samples already stored — skipping")
                    report[letter]["batches"][signer] = {
                        "status": "skipped", "stored": have,
                    }
                    continue
                if have:
                    print(f"  {signer}: only {have}/{len(clips)} stored from an "
                          f"earlier run — re-uploading would duplicate those; "
                          f"skipping, clear them first if you want a clean batch")
                    report[letter]["batches"][signer] = {
                        "status": "partial", "stored": have,
                    }
                    continue
                print(f"  {signer}: {len(clips)} clips …")
                result = upload_batch(client, word_id, letter, signer, clips)
                report[letter]["batches"][signer] = result
                status = result.get("status", "?")
                ok = result.get("success_count", result.get("processed_count", "?"))
                print(f"    -> {status}  stored={ok}")
                if status == "conflict":
                    print("    a batch was already live for this word; stopping so "
                          "the two do not interleave.")
                    return 1

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
