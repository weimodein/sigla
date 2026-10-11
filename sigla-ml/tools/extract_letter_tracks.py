"""Extract hand tracks for every local letter clip, for the offline experiment.

    venv/Scripts/python.exe tools/extract_letter_tracks.py --workers 4

Reads datasets/Alphabets (layout <LETTER>/<signer>/<clip>), writes letter_tracks/<LETTER>/<signer>/<clip>.json.
Skips clips already done, so it can be stopped and resumed.
"""
import argparse
import glob
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)
REPO = os.path.dirname(ML_ROOT)
DEFAULT_DIRS = [os.path.join(REPO, "datasets", "Alphabets")]


def _one(clip: str, out_path: str) -> tuple[str, str]:
    from app.services.extract import extract_hand_track
    with open(clip, "rb") as f:
        track = extract_hand_track(f.read(), os.path.basename(clip))
    if track is None:
        return clip, "no hand"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(track, f)
    return clip, "ok"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-dir", action="append", default=None)
    ap.add_argument("--out", default=os.path.join(ML_ROOT, "letter_tracks"))
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    jobs = []
    for d in args.dataset_dir or DEFAULT_DIRS:
        for clip in sorted(glob.glob(os.path.join(d, "*", "*", "*"))):
            if not clip.lower().endswith((".mov", ".mp4", ".avi", ".mkv")):
                continue
            letter, signer = clip.split(os.sep)[-3], clip.split(os.sep)[-2]
            out_path = os.path.join(args.out, letter, signer,
                                    os.path.splitext(os.path.basename(clip))[0] + ".json")
            if not os.path.exists(out_path):
                jobs.append((clip, out_path))
    print(f"{len(jobs)} clips to extract")
    failed = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(_one, c, o) for c, o in jobs]
        for n, fut in enumerate(as_completed(futures), 1):
            clip, status = fut.result()
            if status != "ok":
                failed += 1
                print(f"  {status}: {clip}")
            if n % 25 == 0:
                print(f"  {n}/{len(jobs)}")
    print(f"done, {failed} without a hand")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
