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

import httpx


BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080/api")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

DATASET_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "datasets", "ALPHABETS",
)

# A batch is ~10 clips and each takes roughly 10s of MediaPipe, so a couple of
# minutes is normal and a stall is the abnormal case worth surfacing.
JOB_TIMEOUT_SECONDS = int(os.getenv("IMPORT_JOB_TIMEOUT", 1200))

CATEGORY = os.getenv("ALPHABET_CATEGORY", "ALPHABET")

from _backend_import import BackendImporter  # noqa: E402  (scripts/ is on sys.path when run directly)

IMPORTER = BackendImporter(BACKEND_URL, ADMIN_TOKEN,
                           job_timeout_seconds=JOB_TIMEOUT_SECONDS,
                           upload_timeout_seconds=300.0)


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
            # vocabulary "letters" is stated explicitly rather than inferred from
            # the label: FSL's NG is one letter spelled with two characters, so no
            # spelling rule can classify the alphabet correctly on its own.
            word_id = IMPORTER.find_or_create_word(client, {
                "label": letter,
                "sign_type": "FSL",
                "category": CATEGORY,
                "description": f"FSL fingerspelling letter {letter}",
                "vocabulary": "letters",
            })
            print(f"\n{letter} (word_id {word_id})")
            report[letter] = {"word_id": word_id, "batches": {}}
            already = IMPORTER.stored_per_signer(client, word_id)
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
                result = IMPORTER.upload_batch(client, word_id, letter, signer, clips)
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
