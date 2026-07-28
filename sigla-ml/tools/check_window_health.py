"""
Re-extraction gate: verify stored samples were windowed with the CURRENT velocity signal.

WHY THIS EXISTS
---------------
extract.py picks the 30-frame window at UPLOAD time and the result is frozen in the
database -- center_on_peak_velocity() no-ops at train time because stored sequences
are already exactly SEQUENCE_LENGTH frames. So a fix to the velocity signal only
reaches data that is re-uploaded afterwards, and there is no way to tell from the
row itself which signal produced it.

This script infers it. It re-measures each stored window with the CURRENT
frame_velocity() and reports where the peak lands:

  Healthy  - the window was centred with this signal, so the peak sits near the
             middle (~frame 15) and few clips peak at the very start.
  Broken   - the window was centred with a DIFFERENT signal. The real motion then
             falls wherever it happens to fall, and in practice it clusters at
             frame <=2: the old hand-landmark signal measured finger articulation,
             so it centred on the static hold AFTER the discriminative arm motion,
             pushing the actual movement to the window's leading edge or out of it.

Measured on the pre-fix dataset, 60-95% of clips per word peaked at frame <=2 --
i.e. most training data did not contain the part of the gesture that identifies it.

USAGE
    # BEFORE re-uploading, save the baseline:
    venv/Scripts/python.exe tools/check_window_health.py > before.txt

    # AFTER re-uploading, confirm it changed:
    venv/Scripts/python.exe tools/check_window_health.py

Exit code is 1 on FAIL so this can gate a script. Requires the backend running
(same BACKEND_URL / ML_API_KEY as training).
"""

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    fetch_approved_samples,
    frame_velocity,
)

# A word fails if more than FAIL_PCT of its clips peak at EARLY_FRAME or before.
#
# CALIBRATION HISTORY — read before changing this.
#
# The original rule assumed "peak at frame <=2" meant "no window was ever
# selected". That was WRONG, and it misdiagnosed the same problem three times.
# Source clips are "raise, sign, lower", and the hand-raise is a LARGER velocity
# spike than the sign (measured: 0.4844 at f2 vs 0.2098 at f16). So a peak at
# frame 2 usually meant the window WAS selected and had correctly found the entry
# movement — a real problem, but a completely different one from "unwindowed",
# and it sent debugging after a healthy ML service and a healthy DB write path.
#
# peak_velocity_index now smooths the velocity and excludes VELOCITY_EDGE_MARGIN
# at each end, so a correct window can no longer be centred on the entry spike.
# The check below is therefore now meaningful: after re-extraction, a peak still
# sitting at the very start means the clip genuinely was not windowed.
#
# It remains a HEURISTIC. A clip whose real motion is at the very start (signer
# already mid-gesture when recording began) legitimately peaks early and cannot be
# centred. Treat a small failing share as data to inspect, not proof of a bug.
EARLY_FRAME = 2
FAIL_PCT = 30.0


def peak_frame(seq: np.ndarray) -> int:
    """Index of the highest-velocity transition under the CURRENT signal."""
    best_i, best_v = 0, 0.0
    for i in range(1, len(seq)):
        v = frame_velocity(seq[i - 1], seq[i])
        if v > best_v:
            best_v, best_i = v, i
    return best_i


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fail-pct", type=float, default=FAIL_PCT,
                    help=f"%% of clips peaking at frame<={EARLY_FRAME} that fails a word "
                         f"(default {FAIL_PCT})")
    args = ap.parse_args()

    dataset = fetch_approved_samples()

    print(f"Window health -- peak frame under the CURRENT velocity signal")
    print(f"(healthy: peak near {SEQUENCE_LENGTH // 2}; broken: mass at frame <= {EARLY_FRAME})")
    print()
    print(f"  {'word':<20} {'n':>4}  {'median':>6}  {'<=' + str(EARLY_FRAME):>6}")
    print(f"  {'-' * 20} {'-' * 4}  {'-' * 6}  {'-' * 6}")

    bad, total_clips, skipped = [], 0, 0
    sample_ids = []   # so a FAIL can report WHICH rows it measured (stale vs new)

    for label in sorted(dataset):
        peaks = []
        for sample in dataset[label]:
            seq = sample.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                skipped += 1
                continue
            sid = sample.get("sample_id")
            if sid is not None:
                sample_ids.append(sid)
            peaks.append(peak_frame(np.array(seq, dtype=np.float32)))

        if not peaks:
            print(f"  {label:<20} {0:>4}  {'--':>6}  {'--':>6}   (no usable samples)")
            continue

        peaks = np.array(peaks)
        total_clips += len(peaks)
        early_pct = float((peaks <= EARLY_FRAME).mean() * 100)
        flag = "  <-- STILL BROKEN" if early_pct > args.fail_pct else ""
        if early_pct > args.fail_pct:
            bad.append(label)
        print(f"  {label:<20} {len(peaks):>4}  {int(np.median(peaks)):>6}  "
              f"{early_pct:>5.1f}%{flag}")

    print()
    if skipped:
        print(f"skipped {skipped} sample(s) with missing/wrong-width sequences")

    if bad:
        print(f"FAIL - {len(bad)} of {len(dataset)} word(s) show unwindowed clips:")
        print(f"       {', '.join(bad)}")
        print()
        # Report the sample ids rather than asserting a cause. An earlier version of
        # this message blamed a stale ML service outright, which sent two separate
        # debugging sessions after a service that was healthy the whole time. The
        # data cannot distinguish "bad windowing" from "these rows predate the fix" —
        # so print the ids and let the reader check.
        if sample_ids:
            lo, hi = min(sample_ids), max(sample_ids)
            print(f"Measured sample ids {lo}..{hi} ({len(sample_ids)} rows).")
        print("FIRST check whether these rows are actually NEW:")
        print("    SELECT max(id), max(created_at) FROM gesture_samples;")
        print("  - ids/timestamps unchanged since before the fix -> these are STALE rows.")
        print("    The upload never wrote anything; look at the backend, not the extractor.")
        print("    (uploadVideos returns HTTP 207 even when every clip fails.)")
        print("  - rows ARE new -> extraction genuinely produced bad windows;")
        print("    confirm the running service predates no source edit, then investigate.")
        print()
        print("Do NOT retrain until this passes - it would bake the bad windows into")
        print("the model, and the mobile app selects windows the new way.")
        return 1

    print(f"PASS - all {len(dataset)} word(s) look correctly windowed ({total_clips} clips).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
