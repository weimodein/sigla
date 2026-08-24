"""
Remove duplicate and mislabelled rows from gesture_samples.

WHAT IT FIXES
-------------
1. CROSS-LABEL COLLISIONS. The same sequence stored under two different words.
   The model is trained to give contradictory answers for one input, which caps
   accuracy no matter what the architecture does. Confirmed instances:

     * 21 sequences under both KNOW and DON'T UNDERSTAND. Checked against the
       FSL-105 source clips with the production extractor: the contested rows sit
       on the DON'T UNDERSTAND centroid 20-1, and KNOW's other batch sits on the
       KNOW centroid 21-0. The KNOW copies (ids 248-268) are the wrong ones.
       This single fault is ~49% of all cross-validation errors and pinned KNOW's
       recall at 50.3%.
     * 4 sequences under both FOUR and SEVEN, matching the 8 SEVEN->FOUR errors.

2. WITHIN-LABEL DUPLICATES. 15 classes were uploaded twice, so ~19% of the table
   is redundant. Labels stay consistent, but identical rows land on both sides of
   a cross-validation fold, so the model is scored on rows it trained on and the
   reported accuracy is optimistic.

HOW IT DECIDES WHAT TO DELETE
-----------------------------
Cross-label: only pairs listed in RESOLUTIONS are touched, and only the side
named there. Anything else is reported and skipped -- guessing which of two
labels is right is not something this script should do silently.

Within-label: keeps the LOWEST sample_id of each identical group. Lowest is the
original upload; the higher ids are the re-upload (`submitted_by=1`, ids ~1200+).

Nothing is deleted without --apply. The default is a dry run.

SAFETY
------
* Dry run by default; --apply is required to write.
* --backup writes the full row set of everything it will delete, so a bad run can
  be reconstructed.
* Runs in ONE transaction and re-verifies the deleted count before COMMIT.
* Refuses to delete a whole class, which would mean the resolution table is wrong.

USAGE
    venv/Scripts/python.exe tools/dedupe_samples.py                       # dry run
    venv/Scripts/python.exe tools/dedupe_samples.py --backup bak.json     # dry run + backup
    venv/Scripts/python.exe tools/dedupe_samples.py --apply --backup bak.json

    # afterwards, for an honest baseline:
    venv/Scripts/python.exe tools/audit_duplicates.py
    venv/Scripts/python.exe tools/cross_validate.py --out cv_deduped.json

Needs PG_URI (same value the backend uses) in the environment or sigla-ml/.env.
The ML API is read-only, so this talks to Postgres directly.
"""

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Cross-label collisions this script is allowed to resolve, and which side is
# wrong. `delete_from` names the label whose copies get removed; the sequences
# survive under the other label.
#
# Both entries were settled the same way: extract the FSL-105 source clips for the
# two words with the production extractor, then check which class centroid each
# contested row actually sits on. A collision with no entry here is REPORTED and
# SKIPPED -- picking a label by guesswork is not this script's job.
RESOLUTIONS = {
    frozenset({"KNOW", "DON'T UNDERSTAND"}): {
        "delete_from": "KNOW",
        "reason": (
            "FSL-105 check: contested rows sit on the DON'T UNDERSTAND centroid "
            "20-1, KNOW's other batch on the KNOW centroid 21-0"
        ),
    },
    frozenset({"FOUR", "SEVEN"}): {
        "delete_from": "FOUR",
        "reason": (
            "FSL-105 check: all 4 contested rows sit on the SEVEN centroid "
            "(~13 vs ~36), unanimous 4-0"
        ),
    },
}


def normalize_label(label: str) -> str:
    return label.replace("’", "'").strip().upper()


def sequence_hash(sequence) -> str:
    return hashlib.sha1(
        np.asarray(sequence, dtype=np.float32).tobytes()
    ).hexdigest()


def plan(dataset: dict) -> tuple[list, list, list]:
    """Return (cross_deletions, within_deletions, unresolved)."""
    index = defaultdict(list)
    for label, samples in dataset.items():
        norm = normalize_label(label)
        for s in samples:
            index[sequence_hash(s["sequence"])].append((norm, s["sample_id"]))

    cross, within, unresolved = [], [], []

    for digest, entries in index.items():
        labels = {lb for lb, _ in entries}

        if len(labels) > 1:
            rule = RESOLUTIONS.get(frozenset(labels))
            if rule is None:
                unresolved.append({
                    "hash": digest[:16],
                    "labels": sorted(labels),
                    "sample_ids": sorted(sid for _, sid in entries),
                })
                continue
            victim = rule["delete_from"]
            for lb, sid in entries:
                if lb == victim:
                    cross.append({
                        "sample_id": sid, "label": lb, "hash": digest[:16],
                        "kept_as": sorted(labels - {victim})[0],
                        "reason": rule["reason"],
                    })
            # The surviving label may still hold its own duplicates of this
            # sequence; those are handled by the within-label pass below.
            entries = [(lb, sid) for lb, sid in entries if lb != victim]
            labels = {lb for lb, _ in entries}

        if len(entries) > 1 and len(labels) == 1:
            ids = sorted(sid for _, sid in entries)
            for sid in ids[1:]:
                within.append({
                    "sample_id": sid, "label": entries[0][0], "hash": digest[:16],
                    "kept": ids[0],
                })

    cross.sort(key=lambda r: r["sample_id"])
    within.sort(key=lambda r: r["sample_id"])
    return cross, within, unresolved


def summarize(dataset, cross, within, unresolved) -> None:
    total = sum(len(v) for v in dataset.values())
    doomed = {r["sample_id"] for r in cross} | {r["sample_id"] for r in within}

    print(f"rows now        {total}")
    print(f"to delete       {len(doomed)}  ({len(cross)} mislabelled, {len(within)} duplicate)")
    print(f"rows after      {total - len(doomed)}")

    if unresolved:
        print(f"\n!! {len(unresolved)} cross-label collisions have NO resolution rule "
              f"and are NOT being touched:")
        by_pair = defaultdict(list)
        for u in unresolved:
            by_pair[" | ".join(u["labels"])].append(u)
        for pair, items in by_pair.items():
            ids = sorted(sid for u in items for sid in u["sample_ids"])
            print(f"     {len(items)} sequences under {pair}")
            print(f"       sample_ids {ids}")
        print("   Decide which label is correct, add it to RESOLUTIONS, re-run.")

    if cross:
        print("\n=== mislabelled rows (cross-label) ===")
        by_label = defaultdict(list)
        for r in cross:
            by_label[(r["label"], r["kept_as"], r["reason"])].append(r["sample_id"])
        for (label, kept, reason), ids in by_label.items():
            ids.sort()
            print(f"  delete {len(ids)} rows from {label}  (survives as {kept})")
            print(f"    reason: {reason}")
            print(f"    sample_ids {ids[0]}..{ids[-1]}")

    if within:
        print("\n=== duplicate rows (within-label, keeping lowest sample_id) ===")
        by_label = defaultdict(list)
        for r in within:
            by_label[r["label"]].append(r["sample_id"])
        for label, ids in sorted(by_label.items(), key=lambda kv: -len(kv[1])):
            print(f"  {label:20s} delete {len(ids):3d}  ids {min(ids)}..{max(ids)}")


def guard(dataset, cross, within) -> None:
    """Refuse obviously wrong plans before any write happens."""
    doomed = {r["sample_id"] for r in cross} | {r["sample_id"] for r in within}
    for label, samples in dataset.items():
        ids = {s["sample_id"] for s in samples}
        if ids and ids <= doomed:
            raise SystemExit(
                f"REFUSING: the plan deletes every row of '{normalize_label(label)}'. "
                f"A resolution rule is wrong."
            )
        remaining = len(ids - doomed)
        if ids and remaining < 5:
            raise SystemExit(
                f"REFUSING: '{normalize_label(label)}' would be left with {remaining} "
                f"rows. Too few to train on; check RESOLUTIONS."
            )


def fetch_rows(conn, ids):
    """
    Full rows for the backup, so a bad run can be reconstructed.

    SELECT * on purpose. An explicit column list has to be kept in step with the
    table -- an earlier version named `updated_at`, which this table does not
    have, and the backup blew up mid-run. A backup that silently omits a column
    is worse still, since the omission only surfaces when someone tries to
    restore. Whatever the table holds is what gets saved.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM gesture_samples WHERE id = ANY(%s)", (list(ids),))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="actually delete (default is a dry run)")
    ap.add_argument("--backup", metavar="PATH",
                    help="write every row that will be deleted, as JSON")
    ap.add_argument("--cache", metavar="PATH",
                    help="read/write the fetched dataset here (the fetch is ~98 MB)")
    args = ap.parse_args()

    from app.utils.preprocessor import fetch_approved_samples

    if args.cache and os.path.exists(args.cache):
        print(f"Reading cached dataset from {args.cache}")
        with open(args.cache) as fh:
            dataset = json.load(fh)
    else:
        dataset = fetch_approved_samples()
        if args.cache:
            with open(args.cache, "w") as fh:
                json.dump(dataset, fh)

    cross, within, unresolved = plan(dataset)
    summarize(dataset, cross, within, unresolved)
    guard(dataset, cross, within)

    doomed = sorted({r["sample_id"] for r in cross} | {r["sample_id"] for r in within})
    if not doomed:
        print("\nNothing to do.")
        return 0

    if not (args.apply or args.backup):
        print("\nDRY RUN -- nothing written. Re-run with --apply (and --backup) to delete.")
        return 0

    pg_uri = os.getenv("PG_URI")
    if not pg_uri:
        raise SystemExit(
            "PG_URI is not set. Copy it from sigla-backend/.env into the environment "
            "or sigla-ml/.env -- the ML API is read-only, so this needs Postgres directly."
        )

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise SystemExit("psycopg2 is required: venv/Scripts/python.exe -m pip install psycopg2-binary")

    conn = psycopg2.connect(pg_uri)
    try:
        if args.backup:
            rows = fetch_rows(conn, doomed)
            with open(args.backup, "w") as fh:
                json.dump(rows, fh, indent=2, default=str)
            print(f"\nBacked up {len(rows)} rows to {args.backup}")
            if len(rows) != len(doomed):
                print(f"  NOTE: {len(doomed) - len(rows)} ids were not found in the table.")

        if not args.apply:
            print("\nDRY RUN -- backup written, nothing deleted. Add --apply to delete.")
            return 0

        # One transaction, verified before commit.
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM gesture_samples")
                before = cur.fetchone()[0]

                cur.execute("DELETE FROM gesture_samples WHERE id = ANY(%s)", (doomed,))
                deleted = cur.rowcount

                cur.execute("SELECT count(*) FROM gesture_samples")
                after = cur.fetchone()[0]

                if before - after != deleted:
                    raise SystemExit(
                        f"ABORTING: row count moved by {before - after} but DELETE "
                        f"reported {deleted}. Rolling back."
                    )
                print(f"\nDeleted {deleted} rows ({before} -> {after}).")
        print("Committed.")
    finally:
        conn.close()

    print("\nNext:")
    print("  venv/Scripts/python.exe tools/audit_duplicates.py")
    print("  venv/Scripts/python.exe tools/cross_validate.py --out cv_deduped.json")
    print("Expect the accuracy to DROP -- the old number was inflated by rows that")
    print("appeared on both sides of a fold. The new one is the honest baseline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
