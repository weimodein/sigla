"""
Import the FSL word clips: create each word, then upload its clips per signer.

Layout expected on disk:

    datasets/FSL Dataset Clips/labels.csv          id,label,category
    datasets/FSL Dataset Clips/<signer>/<id>/*.MOV

Note the nesting is SIGNER-first here, the opposite of ALPHABETS/<LETTER>/<signer>/,
and a class is named by its labels.csv id rather than by its label. Both are
properties of how the dataset was recorded, not choices — hence two scripts.

Self-sufficient by design: it creates any word the backend does not have and
uploads every clip. Words added by hand in the admin UI are reused rather than
duplicated, so running this after a partial manual import is safe and fills in
only what is missing.

Each (word, signer) folder is ONE upload batch. That shape is forced by the
endpoint, not chosen:

  * POST /words/:id/upload-videos takes at most 50 files (multer's
    videoUpload.array("videos", 50)).
  * session_id is REQUIRED and is the signer grouping key for cross-validation.
    Sending the wrong one silently ruins new-signer CV — the same person lands in
    both train and test, and the resulting accuracy looks BETTER, so nothing
    flags it. The folder name IS the signer id, so it is passed through rather
    than generated.
  * The endpoint answers 202 and extracts in the BACKGROUND, refusing a second
    concurrent batch for the same word with 409. Batches for one word therefore
    run one at a time, waiting for each job to reach a terminal state. A naive
    per-clip loop gets 409 on everything after the first and loses it silently.

Usage:

    # what would happen, no requests that change anything
    python scripts/import_words.py --all --dry-run

    # a few classes by label, to check the path end to end first
    python scripts/import_words.py --labels "GOOD MORNING" HELLO

    # one category
    python scripts/import_words.py --category GREETING

    # everything (asks for confirmation)
    python scripts/import_words.py --all

Needs ADMIN_TOKEN (a JWT for an admin user) and, optionally, BACKEND_URL.

Expect this to take hours: extraction runs MediaPipe over every clip, and it
competes with anything else using the CPU. Measured between 15s and 2min per
clip depending on what else was running.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time

import httpx


BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080/api")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

DATASET_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "datasets", "FSL Dataset Clips",
)
LABELS_CSV = os.path.join(DATASET_DIR, "labels.csv")

# The server caps a batch here; keep the client honest rather than discovering it
# as a 400 halfway through a run.
MAX_FILES_PER_BATCH = 50

# A batch is ~10 clips and each takes tens of seconds of MediaPipe, so minutes
# are normal and a stall is the abnormal case worth surfacing.
JOB_POLL_SECONDS = 5
JOB_TIMEOUT_SECONDS = int(os.getenv("IMPORT_JOB_TIMEOUT", 2400))

VIDEO_EXTS = (".mov", ".mp4", ".avi", ".mkv")


def _headers() -> dict:
    if not ADMIN_TOKEN:
        sys.exit("ADMIN_TOKEN is not set — needs a JWT for an admin user.")
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


def read_labels() -> dict[str, dict]:
    """{class_id: {"label": ..., "category": ...}} from labels.csv.

    Opened with utf-8-sig: the file carries a BOM, which would otherwise land
    inside the first column name and make the id lookup miss every row.
    """
    if not os.path.isfile(LABELS_CSV):
        sys.exit(f"labels.csv not found: {LABELS_CSV}")
    out: dict[str, dict] = {}
    with io.open(LABELS_CSV, encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            cid = (row.get("id") or "").strip()
            label = (row.get("label") or "").strip()
            if not cid or not label:
                continue
            out[cid] = {
                "label": label,
                "category": (row.get("category") or "").strip() or "additional words",
            }
    return out


def discover(selected: set[str] | None) -> dict[str, dict]:
    """{class_id: {"label", "category", "signers": {signer: [paths]}}}.

    `selected` filters by LABEL, since that is what an operator knows; the
    numeric ids are an artifact of how the clips were foldered.
    """
    if not os.path.isdir(DATASET_DIR):
        sys.exit(f"dataset folder not found: {DATASET_DIR}")

    labels = read_labels()
    signers = sorted(
        name for name in os.listdir(DATASET_DIR)
        if os.path.isdir(os.path.join(DATASET_DIR, name))
    )

    found: dict[str, dict] = {}
    for cid, meta in labels.items():
        if selected is not None and meta["label"].upper() not in selected:
            continue
        per_signer: dict[str, list[str]] = {}
        for signer in signers:
            cdir = os.path.join(DATASET_DIR, signer, cid)
            if not os.path.isdir(cdir):
                continue
            clips = [
                os.path.join(cdir, f)
                for f in sorted(os.listdir(cdir))
                if f.lower().endswith(VIDEO_EXTS)
            ]
            if clips:
                per_signer[signer] = clips
        if per_signer:
            found[cid] = {**meta, "signers": per_signer}
    return found


def find_or_create_word(client: httpx.Client, label: str, category: str) -> int:
    """Word id for `label`, creating it if the backend does not have one.

    adminAddWord answers 409 with the existing word_id when the label is already
    taken, so words added by hand in the UI are reused and a re-run of this
    script never duplicates one.

    vocabulary is left to default ("words"). These are the main vocabulary; the
    alphabet is imported separately and must stay in its own model, because a
    letter and the day sign built from it differ only in motion.
    """
    r = client.post(
        f"{BACKEND_URL}/words/admin-add",
        headers=_headers(),
        json={
            "label": label,
            "sign_type": "FSL",
            "category": category,
            "description": f"FSL sign for {label}",
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


def stored_per_signer(client: httpx.Client, word_id: int) -> dict[str, int]:
    """How many samples each session_id already has stored for this word.

    Makes a re-run resumable, and makes the script safe to point at a word whose
    clips were partly uploaded through the UI. Counts rather than presence,
    because an interrupted batch leaves a PARTIAL one — treating "signer appears
    at all" as done would silently abandon the rest.
    """
    r = client.get(f"{BACKEND_URL}/words/{word_id}/samples",
                   headers=_headers(), timeout=120.0)
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


def wait_for_job(client: httpx.Client, job_id: int, label: str, signer: str) -> dict:
    """Block until a job leaves 'processing'.

    Waiting is not optional: starting the next batch for the same word while this
    one is live earns a 409 and drops the clips.
    """
    deadline = time.time() + JOB_TIMEOUT_SECONDS
    while time.time() < deadline:
        time.sleep(JOB_POLL_SECONDS)
        # A dropped connection is not a failed import. The job runs on the
        # SERVER, detached from this request, so losing the socket only costs
        # the status update — extraction carries on. Letting the transport error
        # propagate once killed a whole run on its first batch while the backend
        # happily finished that batch alone.
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


def upload_batch(client: httpx.Client, word_id: int, label: str,
                 signer: str, clips: list[str]) -> dict:
    """One (word, signer) batch, then wait for its job to finish.

    Waits out any job already live for this word first. The endpoint answers 409
    while one is processing, so an interrupted earlier run — or an upload started
    in the admin UI — leaves a job that must finish before this word accepts more.
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
                timeout=600.0,
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
    g.add_argument("--labels", nargs="+", help='e.g. "GOOD MORNING" HELLO')
    g.add_argument("--category", help="every label in one labels.csv category")
    g.add_argument("--all", action="store_true", help="every label on disk")
    ap.add_argument("--dry-run", action="store_true",
                    help="show the plan; make no changes")
    ap.add_argument("--json", metavar="PATH", help="write a per-batch report")
    args = ap.parse_args()

    selected: set[str] | None = None
    if args.labels:
        selected = {l.upper() for l in args.labels}
    elif args.category:
        wanted_cat = args.category.strip().upper()
        selected = {
            meta["label"].upper()
            for meta in read_labels().values()
            if meta["category"].upper() == wanted_cat
        }
        if not selected:
            sys.exit(f"no labels in category {args.category!r}")

    found = discover(selected)
    if not found:
        sys.exit("nothing to import — check --labels/--category against labels.csv")

    n_batches = sum(len(c["signers"]) for c in found.values())
    n_clips = sum(len(v) for c in found.values() for v in c["signers"].values())
    print(f"{len(found)} words, {n_batches} batches, {n_clips} clips")
    for cid, c in sorted(found.items(), key=lambda kv: kv[1]["label"]):
        detail = "  ".join(f"{s}={len(v)}" for s, v in c["signers"].items())
        print(f"  {c['label']:22} [{c['category']}]  {detail}")

    if args.dry_run:
        print("\ndry run — nothing sent.")
        return 0

    if args.all:
        # Hours of extraction, and it writes to the live database. Make it
        # deliberate rather than one reflexive keystroke.
        reply = input(f"\nImport all {n_clips} clips across {len(found)} words? [y/N] ")
        if reply.strip().lower() != "y":
            print("aborted.")
            return 1

    report: dict[str, dict] = {}
    with httpx.Client() as client:
        for cid, c in sorted(found.items(), key=lambda kv: kv[1]["label"]):
            label = c["label"]
            word_id = find_or_create_word(client, label, c["category"])
            print(f"\n{label} (word_id {word_id})")
            report[label] = {"word_id": word_id, "batches": {}}
            already = stored_per_signer(client, word_id)

            for signer, clips in c["signers"].items():
                # Some clips are legitimately rejected by the quality gates, so a
                # complete batch is not always len(clips) rows. Anything within a
                # couple of rows is treated as done; a badly short one is not,
                # since that is what an interrupted batch looks like.
                have = already.get(signer, 0)
                if have >= len(clips) - 2:
                    print(f"  {signer}: {have} samples already stored — skipping")
                    report[label]["batches"][signer] = {"status": "skipped", "stored": have}
                    continue
                if have:
                    print(f"  {signer}: only {have}/{len(clips)} stored from an "
                          f"earlier run — re-uploading would duplicate those; "
                          f"skipping, clear them first if you want a clean batch")
                    report[label]["batches"][signer] = {"status": "partial", "stored": have}
                    continue

                print(f"  {signer}: {len(clips)} clips …")
                result = upload_batch(client, word_id, label, signer, clips)
                report[label]["batches"][signer] = result
                status = result.get("status", "?")
                ok = result.get("success_count", result.get("processed_count", "?"))
                print(f"    -> {status}  stored={ok}")
                if status == "conflict":
                    print("    a batch was already live for this word; stopping so "
                          "the two do not interleave.")
                    return 1

                if args.json:
                    # Written as we go, not at the end. A run this long will
                    # sometimes be interrupted, and a report that only exists on
                    # clean completion is no use precisely then.
                    with open(args.json, "w", encoding="utf-8") as fh:
                        json.dump(report, fh, indent=2)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
