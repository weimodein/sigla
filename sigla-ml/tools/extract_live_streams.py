"""
Whole-clip landmark streams for the live-replay test (tools/live_replay.py).

Training stores ONE peak-centred 30-frame window per clip. The app instead sees
the whole camera stream: idle start, raise, sign, lower. This extracts every
frame of a clip at TARGET_SAMPLE_FPS (24, the training rate) with the same
detectors and per-frame normalisation as extract.py, WITHOUT trimming, so a
replay of it looks like what the phone gets.

Output, one .npz per clip in --out:
    frames  [N, 147] float32  normalised features (zeros where no hand)
    hands   [N]      int8     hands detected (0 = no hand)
    label, signer, clip

    venv/Scripts/python.exe tools/extract_live_streams.py \
        --clips "../datasets/FSL Dataset Clips" --signers signer-01 \
        --words-from dataset.pkl --out live_streams --workers 4
"""

import argparse
import csv
import os
import pickle
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _norm(s: str) -> str:
    return s.upper().replace("’", "'").strip()


def clip_jobs(root: str, signers: list, words: list) -> list:
    rows = list(csv.reader(open(os.path.join(root, "labels.csv"), encoding="utf-8-sig")))[1:]
    by_name = {_norm(w): w for w in words}
    ids = {r[0]: by_name[_norm(r[1])] for r in rows
           if r and r[0].strip().isdigit() and _norm(r[1]) in by_name}
    jobs = []
    for s in signers:
        for i, label in sorted(ids.items()):
            d = os.path.join(root, s, i)
            if os.path.isdir(d):
                jobs += [(os.path.join(d, f), label, s) for f in sorted(os.listdir(d))]
    return jobs


def extract_stream(path: str):
    import cv2
    from app.services.clip_prep import TARGET_SAMPLE_FPS
    from app.services.extract import (DEFAULT_SOURCE_FPS, _build_feature_vector, _detect,
                                      _detect_pose, _make_landmarker, _make_pose_landmarker)
    from app.utils.preprocessor import normalize_frame

    cap = cv2.VideoCapture(path)
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not np.isfinite(fps) or fps <= 1.0:
            fps = DEFAULT_SOURCE_FPS
        step = max(fps / TARGET_SAMPLE_FPS, 1.0)
        frames, hands = [], []
        with _make_landmarker() as hl, _make_pose_landmarker() as pl:
            i, nxt = 0, 0.0
            while True:
                ok, img = cap.read()
                if not ok:
                    break
                if i >= nxt:
                    nxt += step
                    r = _detect(hl, img)
                    if not r.hand_landmarks:
                        frames.append(np.zeros(147, np.float32))
                        hands.append(0)
                    else:
                        pr = _detect_pose(pl, img)
                        pose = pr.pose_landmarks[0] if pr.pose_landmarks else None
                        vec = _build_feature_vector(r.hand_landmarks, pose)
                        frames.append(normalize_frame(np.asarray(vec, np.float32)))
                        hands.append(len(r.hand_landmarks))
                i += 1
        return np.stack(frames) if frames else np.zeros((0, 147), np.float32), np.array(hands, np.int8)
    finally:
        cap.release()


def _work(job, out_dir):
    path, label, signer = job
    name = f"{signer}__{os.path.basename(os.path.dirname(path))}__{os.path.splitext(os.path.basename(path))[0]}.npz"
    dst = os.path.join(out_dir, name)
    if os.path.exists(dst):
        return name, "cached"
    frames, hands = extract_stream(path)
    np.savez_compressed(dst, frames=frames, hands=hands, label=label, signer=signer, clip=path)
    return name, f"{len(hands)} frames, {int((hands > 0).sum())} with hands"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", required=True)
    ap.add_argument("--signers", nargs="+", required=True)
    ap.add_argument("--words-from", required=True, help="pickle of fetch_approved_samples()")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--every", type=int, default=1, help="only every Nth clip of each word")
    args = ap.parse_args()

    words = sorted(k for k in pickle.load(open(args.words_from, "rb")) if len(k) > 1)
    jobs = clip_jobs(args.clips, args.signers, words)
    if args.every > 1:
        seen = {}
        kept = []
        for j in jobs:
            k = (j[2], j[1])
            seen[k] = seen.get(k, -1) + 1
            if seen[k] % args.every == 0:
                kept.append(j)
        jobs = kept
    os.makedirs(args.out, exist_ok=True)
    print(f"[streams] {len(jobs)} clips, {len({j[1] for j in jobs})} words", flush=True)
    done = 0
    with ProcessPoolExecutor(args.workers) as pool:
        futs = [pool.submit(_work, j, args.out) for j in jobs]
        for f in as_completed(futs):
            done += 1
            try:
                name, msg = f.result()
                if done % 25 == 0 or done == len(jobs):
                    print(f"[streams] {done}/{len(jobs)} {name}: {msg}", flush=True)
            except Exception as e:  # one bad clip must not stop the run
                print(f"[streams] {done}/{len(jobs)} FAILED: {e}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
