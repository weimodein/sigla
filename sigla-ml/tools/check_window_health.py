"""
Re-extraction gate: verify stored samples were windowed with the CURRENT velocity signal.

WHY THIS EXISTS
---------------
extract.py picks the 30-frame window at UPLOAD time and the result is frozen in the
database -- center_on_peak_velocity() no-ops at train time because stored sequences
are already exactly SEQUENCE_LENGTH frames. So a fix to the velocity signal only
reaches data that is re-uploaded afterwards, and there is no way to tell from the
row itself which signal produced it.

This script infers it by re-running the PRODUCTION picker (peak_velocity_index)
over each stored window and reporting where it lands:

  Healthy  - the picker finds the gesture near the middle (~frame 15), i.e. the
             window was centred on the sign.
  Broken   - the picker lands at the very start, meaning the stored window does not
             actually contain a centred gesture.

IMPORTANT - use the production picker, never a plain argmax.
------------------------------------------------------------
An earlier version of this script computed its own `np.argmax` over the stored
window. That produced a FALSE FAIL on correctly-windowed data, because the window
has already been CHOSEN: the clip's entry spike (hands moving into frame, or
MediaPipe snapping onto them) is still present inside the window, it simply is not
what the window was centred on.

Worked example, sample id=147 (THANK YOU): raw velocity f1=1.0010 -- the pose wrist
y jumps 1.378 -> 0.637 -> 0.374 as the hands enter the frame -- while the real sign
is at f10=0.397 / f11=0.541. peak_velocity_index correctly returned f10. A plain
argmax re-measured the stored window, found the f1 remnant, and called it broken.

Across all 206 re-uploaded clips: raw argmax said 5-55% of clips per word peaked at
frame <=2, while the production picker said 0.0% for EVERY word, with medians of
10-16. The data was correct; the metric was not.

This is the same class of bug as a test re-implementing the code it is meant to
guard: measure with the real function, not a copy of it.

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
    peak_velocity_index,
)

# A word fails if more than FAIL_PCT of its clips have the PRODUCTION picker land
# at EARLY_FRAME or before.
#
# CALIBRATION HISTORY — read before changing this.
#
# This heuristic has produced three misleading verdicts, each time sending
# debugging at a healthy component (the ML service twice, the DB write path once).
# Both root causes are now fixed and encoded above:
#   1. it assumed "early peak" meant "no window selected", when it usually meant
#      the window WAS selected and had centred on the hand-raise (fixed in the
#      pipeline by peak_velocity_index's smoothing + edge margin);
#   2. it measured with its own argmax instead of the production picker, which
#      re-found the entry spike still sitting inside an already-correct window
#      (fixed here by calling peak_velocity_index).
#
# It remains a HEURISTIC. A clip where the signer was already mid-gesture when
# recording started legitimately peaks early and cannot be centred. Treat a small
# failing share as data to inspect, never as proof of a bug — and confirm any FAIL
# against the raw numbers before changing pipeline code.
EARLY_FRAME = 2
FAIL_PCT = 30.0


def peak_frame(seq: np.ndarray) -> int:
    """Where the PRODUCTION picker finds the gesture in this stored window.

    Deliberately delegates rather than re-implementing: a local argmax here is what
    produced a false FAIL on correctly-windowed data (see the module docstring).
    """
    return peak_velocity_index(seq)


def raw_argmax_frame(seq: np.ndarray) -> int:
    """Plain argmax — reported alongside the picker for diagnosis only.

    A large gap between this and peak_frame is EXPECTED and healthy: it means the
    window contains an entry/exit spike that the picker correctly declined to
    centre on. Never gate on this value.
    """
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

    print(f"Window health -- where the PRODUCTION picker finds the gesture")
    print(f"(healthy: median near {SEQUENCE_LENGTH // 2}; broken: mass at frame <= {EARLY_FRAME})")
    print(f"raw<=2 is DIAGNOSTIC ONLY -- a high value there with a healthy picker")
    print(f"column just means the window contains an entry spike it declined to centre on.")
    print()
    print(f"  {'word':<20} {'n':>4}  {'median':>6}  {'<=' + str(EARLY_FRAME):>6}  {'raw<=2':>7}")
    print(f"  {'-' * 20} {'-' * 4}  {'-' * 6}  {'-' * 6}  {'-' * 7}")

    bad, total_clips, skipped = [], 0, 0
    sample_ids = []   # so a FAIL can report WHICH rows it measured (stale vs new)

    for label in sorted(dataset):
        peaks, raws = [], []
        for sample in dataset[label]:
            seq = sample.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                skipped += 1
                continue
            sid = sample.get("sample_id")
            if sid is not None:
                sample_ids.append(sid)
            arr = np.array(seq, dtype=np.float32)
            peaks.append(peak_frame(arr))
            raws.append(raw_argmax_frame(arr))

        if not peaks:
            print(f"  {label:<20} {0:>4}  {'--':>6}  {'--':>6}  {'--':>7}   (no usable samples)")
            continue

        peaks = np.array(peaks)
        raws = np.array(raws)
        total_clips += len(peaks)
        early_pct = float((peaks <= EARLY_FRAME).mean() * 100)
        raw_pct = float((raws <= EARLY_FRAME).mean() * 100)
        flag = "  <-- STILL BROKEN" if early_pct > args.fail_pct else ""
        if early_pct > args.fail_pct:
            bad.append(label)
        print(f"  {label:<20} {len(peaks):>4}  {int(np.median(peaks)):>6}  "
              f"{early_pct:>5.1f}%  {raw_pct:>6.1f}%{flag}")

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
        print("This is measured with the PRODUCTION picker, so it is not the")
        print("false-alarm mode that a plain argmax used to produce. Check, in order:")
        print("  1. Are these rows actually NEW?")
        print("       SELECT max(id), max(created_at) FROM gesture_samples;")
        print("     Unchanged since before the last extractor change -> STALE rows; the")
        print("     upload wrote nothing. Look at the backend, not the extractor.")
        print("     (uploadVideos returns HTTP 207 even when every clip fails.)")
        print("  2. Inspect a failing clip's velocity profile before changing any code.")
        print("     A signer already mid-gesture at frame 0 legitimately peaks early.")
        print("  3. Only then suspect the extraction path.")
        print()
        print("Do NOT retrain until this passes - it would bake the bad windows into")
        print("the model, and the mobile app selects windows the new way.")
        return 1

    print(f"PASS - all {len(dataset)} word(s) look correctly windowed ({total_clips} clips).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
