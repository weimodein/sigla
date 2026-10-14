"""
"Not a sign" windows for the words model, from whole-clip streams
(tools/extract_live_streams.py).

The words model has no way to say "this is not a sign": every hand movement
must become one of the words, and on the phone unclear movement (raising the
hands, resting, moving between signs) fired I'M FINE in 13% of runs. Letters
became reliable once they had a none class; this builds the words equivalent.

Each clip is replayed the way the phone sees it (12 fps detection, rebuilt to
24 by FrameRateBridge) and every window the app would classify is collected.
The sign is located the way training locates it (peak velocity over the
hand-visible span). A window whose buffer ENDS before the sign starts (only the
raise / shared opening) or STARTS after it ends (the lowering) is a none
window. Windows overlapping the sign are left out: they are neither clearly
the word nor clearly not.

Output: one .npz with windows [N, 30, 147], signer [N], label [N] (the word
the clip was, for analysis only), where [N] ("before" / "after").

Nothing here touches the shared database; the file stays local.

    venv/Scripts/python.exe tools/build_none_windows.py --streams live_streams_all \
        --out none_windows.npz
"""

import argparse
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import live_replay as R  # noqa: E402
from app.utils.preprocessor import peak_velocity_index  # noqa: E402

PHONE_FPS = 12.0
SIGN_HALF = 15        # the stored training window is 30 frames centred on the peak


def none_windows(frames: np.ndarray, hands: np.ndarray, phone_fps: float = PHONE_FPS):
    """(windows, where) for one stream, as the phone would see it."""
    if phone_fps < R.FPS:
        keep = np.unique(np.floor(np.arange(0, len(hands), R.FPS / phone_fps)).astype(int))
        frames, hands = frames[keep], hands[keep]
        frames, hands = R.upsample_stream(frames, hands, phone_fps, R.FPS)
    idx = np.where(hands > 0)[0]
    if len(idx) < 2 * SIGN_HALF:
        return [], []
    span = frames[idx[0]:idx[-1] + 1]
    peak = idx[0] + peak_velocity_index(span)
    sign_lo, sign_hi = peak - SIGN_HALF, peak + SIGN_HALF
    out, where = [], []
    for (first, last), w in R.clip_windows(frames, hands).items():
        if last < sign_lo:
            out.append(w)
            where.append("before")
    # After a word fires the app resets and the next buffer starts on whatever
    # follows — usually the hands coming down. Replay only the frames after the
    # sign as a fresh buffer to get those windows.
    after = hands.copy()
    after[:sign_hi + 1] = 0
    for _, w in R.clip_windows(frames, after).items():
        out.append(w)
        where.append("after")
    return out, where


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--streams", nargs="+", required=True, help="directories of stream .npz")
    ap.add_argument("--out", required=True)
    ap.add_argument("--phone-fps", type=float, default=PHONE_FPS)
    args = ap.parse_args()

    wins, signers, labels, wheres = [], [], [], []
    files = sorted(f for d in args.streams for f in glob.glob(os.path.join(d, "*.npz")))
    for n, path in enumerate(files, 1):
        z = np.load(path, allow_pickle=True)
        w, where = none_windows(z["frames"], z["hands"], args.phone_fps)
        wins += w
        wheres += where
        signers += [str(z["signer"])] * len(w)
        labels += [str(z["label"])] * len(w)
        if n % 200 == 0:
            print(f"[none] {n}/{len(files)} clips, {len(wins)} windows", flush=True)
    np.savez_compressed(args.out, windows=np.stack(wins).astype(np.float32),
                        signer=np.array(signers), label=np.array(labels), where=np.array(wheres))
    from collections import Counter
    print(f"[none] {len(wins)} windows from {len(files)} clips: {dict(Counter(wheres))}, "
          f"per signer {dict(Counter(signers))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
