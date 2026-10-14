"""
Live replay: feed whole-clip landmark streams (tools/extract_live_streams.py)
through a line-by-line Python copy of the words path in sigla-mobile
PredictionService.kt — growing buffer, slide every 2 frames, peak-centred
window, pose/motion gates, 3-window probability mean, margin, streaks,
timer and end-of-gesture flush — and report what the phone would show.

Why: the offline test scores one clean peak-centred window per clip. The app
classifies many partial windows of a stream and fires on the first one that
passes its rules. Model 1.1.2 won offline and lost on the phone; only a test of
the live path can tell those apart before anything ships.

Per clip the FIRST fired word counts (the app resets after it): right, wrong,
or nothing. Ten hands-down frames are appended to every clip, as when the
signer lowers their hands, so the end-of-gesture flush can run.

The constants below MUST match PredictionService.kt.
"""

import os
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.utils.preprocessor import (  # noqa: E402
    _pose_present, frame_velocity, hand_extent_ok, peak_velocity_index,
)

FPS = 24.0
SEQUENCE_LENGTH = 30
MIN_MOTION_FRAMES = 12
MIN_COMPLETE_GESTURE_FRAMES = 36
MOTION_SLIDE_INTERVAL = 2
MOTION_THRESHOLD = 0.80
MOTION_EARLY_CONF = 0.80
MOTION_MIN_MARGIN = 0.15
MIN_POSE_FRAMES = 24
MIN_REAL_FRAMES_FOR_FIRE = 20
MIN_SEQUENCE_MOTION = 0.50
MOTION_EARLY_STREAK = 10
EARLY_EXIT_THRESHOLD = 0.90
EARLY_EXIT_STREAK = 4
BUFFER_CAPACITY = 90
NO_HAND_TIMEOUT = 6
BUFFER_FILL_MS = 1500.0
DETECTION_COOLDOWN_MS = 2000.0
PROBABILITY_CONSENSUS_WINDOWS = 3
TAIL_NO_HAND_FRAMES = 10

NONE, TIMER, END = 0, 1, 2


def extract_motion_window(frames: list) -> np.ndarray:
    """PredictionService.extractMotionWindow."""
    if len(frames) == SEQUENCE_LENGTH:
        return np.stack(frames)
    if len(frames) < SEQUENCE_LENGTH:
        return np.stack(frames + [frames[-1]] * (SEQUENCE_LENGTH - len(frames)))
    peak = peak_velocity_index(np.stack(frames))
    start = max(peak - SEQUENCE_LENGTH // 2, 0)
    end = start + SEQUENCE_LENGTH
    if end > len(frames):
        end = len(frames)
        start = max(end - SEQUENCE_LENGTH, 0)
    w = frames[start:end]
    return np.stack(w + [w[-1]] * (SEQUENCE_LENGTH - len(w)))


def window_gates_ok(w: np.ndarray) -> bool:
    if sum(_pose_present(f) for f in w) < MIN_POSE_FRAMES:
        return False
    energy = sum(frame_velocity(w[i], w[i + 1]) for i in range(len(w) - 1))
    return energy >= MIN_SEQUENCE_MOTION


def replay_clip(frames: np.ndarray, hands: np.ndarray, predict) -> dict:
    """predict(window[30,147], key) -> probabilities. Returns the first fire."""
    tail = np.zeros((TAIL_NO_HAND_FRAMES, frames.shape[1]), np.float32)
    frames = np.concatenate([frames, tail])
    hands = np.concatenate([hands, np.zeros(TAIL_NO_HAND_FRAMES, hands.dtype)])

    buf = deque()                 # (frame index, frame)
    collecting, buf_start, since_run = False, 0.0, 0
    streak, streak_label = 0, -1
    history = deque()
    no_hand = 0
    last_detection = -1e12
    runs = 0

    def reset():
        nonlocal collecting, buf_start, since_run, streak, streak_label
        buf.clear()
        collecting, buf_start, since_run = False, 0.0, 0
        streak, streak_label = 0, -1
        history.clear()

    def run(force):
        nonlocal streak, streak_label, runs
        if len(buf) < MIN_MOTION_FRAMES:
            streak, streak_label = 0, -1
            return None
        w = extract_motion_window([f for _, f in buf])
        if not window_gates_ok(w):
            streak, streak_label = 0, -1
            return None
        runs += 1
        p = predict(w, (buf[0][0], buf[-1][0]))
        history.append(p)
        while len(history) > PROBABILITY_CONSENSUS_WINDOWS:
            history.popleft()
        cons = np.mean(np.stack(history), axis=0)
        idx = int(np.argmax(cons))
        conf = float(cons[idx])
        second = float(np.max(np.delete(cons, idx))) if len(cons) > 1 else -np.inf
        if conf - second < MOTION_MIN_MARGIN:
            streak, streak_label = 0, -1
            return None
        if conf >= MOTION_EARLY_CONF:
            if streak_label == idx:
                streak += 1
            else:
                streak_label, streak = idx, 1
        else:
            streak, streak_label = 0, -1
        bypass = force == END
        if not (bypass or len(buf) >= MIN_COMPLETE_GESTURE_FRAMES):
            return None
        if len(buf) < MIN_REAL_FRAMES_FOR_FIRE:
            return None
        if conf >= EARLY_EXIT_THRESHOLD:
            if streak >= EARLY_EXIT_STREAK or bypass:
                return idx, conf
        elif conf >= MOTION_EARLY_CONF and streak >= MOTION_EARLY_STREAK:
            return idx, conf
        if conf >= MOTION_THRESHOLD:
            if bypass or (force == TIMER and streak >= MOTION_EARLY_STREAK):
                return idx, conf
        return None

    for i in range(len(frames)):
        now = i * 1000.0 / FPS
        f = frames[i]
        usable = hands[i] > 0 and hand_extent_ok(f)
        if not usable:
            no_hand += 1
            if no_hand >= NO_HAND_TIMEOUT and (collecting or buf):
                hit = None
                if len(buf) >= MIN_MOTION_FRAMES and now - last_detection >= DETECTION_COOLDOWN_MS:
                    hit = run(END)
                reset()
                if hit:
                    return {"pred": hit[0], "conf": hit[1], "frame": i, "how": "end", "runs": runs}
            continue
        no_hand = 0
        if now - last_detection < DETECTION_COOLDOWN_MS:
            continue
        if not collecting:
            collecting, buf_start = True, now
        buf.append((i, f))
        while len(buf) > BUFFER_CAPACITY:
            buf.popleft()
        since_run += 1
        force_run = now - buf_start >= BUFFER_FILL_MS and len(buf) >= SEQUENCE_LENGTH
        slide_run = len(buf) >= MIN_MOTION_FRAMES and since_run >= MOTION_SLIDE_INTERVAL
        hit = None
        if force_run:
            since_run = 0
            hit = run(TIMER)
        elif slide_run:
            since_run = 0
            hit = run(NONE)
        if hit:
            return {"pred": hit[0], "conf": hit[1], "frame": i, "how": "live", "runs": runs}
    return {"pred": None, "conf": 0.0, "frame": None, "how": "none", "runs": runs}


def _blend_frames(a: np.ndarray, b: np.ndarray, w: float) -> np.ndarray:
    """A frame a fraction w of the way from a to b. Each hand block and the pose
    block are interpolated only when present in BOTH frames; otherwise the later
    frame's block is used, so a hand never fades in from the zero sentinel."""
    out = b.copy()
    for lo, hi in ((0, 63), (63, 126), (126, 147)):
        if np.any(a[lo:hi]) and np.any(b[lo:hi]):
            out[lo:hi] = a[lo:hi] + (b[lo:hi] - a[lo:hi]) * w
    return out


def upsample_stream(frames: np.ndarray, hands: np.ndarray, src_fps: float,
                    dst_fps: float = 24.0, max_fill: int = 3):
    """The proposed app fix, applied offline: rebuild the frames the phone
    dropped so the buffer runs at the training rate. Between two consecutive
    hand frames, insert in-between frames; a hands-down frame stands for as many
    hands-down slots as the gap covers. At most `max_fill` frames are added per
    gap, so a long stall is not invented into motion."""
    slots = dst_fps / src_fps
    out_f, out_h = [], []
    acc = 0.0
    for i in range(len(hands)):
        acc += slots
        n = max(1, int(round(acc)))
        acc -= n
        fill = min(n - 1, max_fill)
        if hands[i] > 0 and i > 0 and hands[i - 1] > 0:
            for k in range(1, fill + 1):
                out_f.append(_blend_frames(frames[i - 1], frames[i], k / (fill + 1)))
                out_h.append(hands[i])
        else:
            for _ in range(fill):
                out_f.append(np.zeros_like(frames[i]) if hands[i] == 0 else frames[i])
                out_h.append(hands[i])
        out_f.append(frames[i])
        out_h.append(hands[i])
    return np.stack(out_f).astype(np.float32), np.array(out_h, hands.dtype)


# ── evaluation ──────────────────────────────────────────────────────────────

def clip_windows(frames, hands) -> dict:
    """Every window the app would classify before its first fire. Until a word
    fires, which windows are built does not depend on the model, so a predictor
    that never fires (uniform output, margin 0) walks all of them."""
    seen = {}

    def collect(w, key):
        seen[key] = w
        return np.full(2, 0.5, np.float32)
    replay_clip(frames, hands, collect)
    return seen


def sharpen(p, t):
    if t is None:
        return p
    lg = np.log(p + 1e-9) / t
    e = np.exp(lg - lg.max())
    return e / e.sum()


def main() -> int:
    global FPS, MOTION_SLIDE_INTERVAL, MOTION_EARLY_STREAK, EARLY_EXIT_STREAK
    import argparse
    import glob
    import json
    import os
    import sys
    from collections import Counter

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import tensorflow as tf
    import app.services.words_blend  # noqa: F401  (registers the custom layers)

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--streams", required=True)
    ap.add_argument("--models", required=True, help="dir with <name>.keras and labels.txt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=FPS,
                    help="replay as if the phone processed this many frames per second "
                         "(streams are extracted at 24; lower drops frames evenly)")
    ap.add_argument("--variants", nargs="*", help="only these variants")
    ap.add_argument("--upsample", action="store_true",
                    help="apply the proposed app fix: rebuild dropped frames back to 24 fps")
    ap.add_argument("--slide", type=int, default=MOTION_SLIDE_INTERVAL,
                    help="run the model every N buffer frames (app: MOTION_SLIDE_INTERVAL)")
    ap.add_argument("--early-streak", type=int, default=MOTION_EARLY_STREAK)
    ap.add_argument("--exit-streak", type=int, default=EARLY_EXIT_STREAK)
    args = ap.parse_args()
    MOTION_SLIDE_INTERVAL, MOTION_EARLY_STREAK, EARLY_EXIT_STREAK = (
        args.slide, args.early_streak, args.exit_streak)
    keep_ratio = min(args.fps / FPS, 1.0)
    src_fps = min(args.fps, FPS)
    if not args.upsample:
        FPS = src_fps

    labels = open(os.path.join(args.models, "labels.txt")).read().split("\n")
    comps = {os.path.basename(p)[:-6]: tf.keras.models.load_model(p, compile=False)
             for p in sorted(glob.glob(os.path.join(args.models, "*.keras")))}
    print(f"[replay] models: {', '.join(comps)}", flush=True)

    variants = {"lstm": lambda c: c["lstm"], "conv": lambda c: c["conv"]}
    for lin in ("linear_clean", "linear_aug"):
        if lin not in comps:
            continue
        variants[lin] = (lambda lin: lambda c: c[lin])(lin)
        for w in (0.5, 0.7):
            for t in (None, 0.5, 0.35):
                name = f"conv+{lin}@{w}" + (f"_T{t}" if t else "")
                variants[name] = (lambda lin, w, t: lambda c: sharpen(w * c[lin] + (1 - w) * c["conv"], t))(lin, w, t)

    if args.variants:
        variants = {k: v for k, v in variants.items() if k in args.variants}

    files = sorted(glob.glob(os.path.join(args.streams, "*.npz")))
    rows = {v: [] for v in variants}
    for n, path in enumerate(files, 1):
        z = np.load(path, allow_pickle=True)
        label = str(z["label"])
        if label not in labels:
            continue
        truth = labels.index(label)
        frames, hands = z["frames"], z["hands"]
        if keep_ratio < 1.0:
            keep = np.unique(np.floor(np.arange(0, len(hands), 1.0 / keep_ratio)).astype(int))
            frames, hands = frames[keep], hands[keep]
            if args.upsample:
                frames, hands = upsample_stream(frames, hands, src_fps, FPS)
        wins = clip_windows(frames, hands)
        cache = {}
        if wins:
            keys = list(wins)
            batch = np.stack([wins[k] for k in keys]).astype(np.float32)
            outs = {name: m.predict(batch, verbose=0, batch_size=256) for name, m in comps.items()}
            cache = {k: {name: outs[name][i] for name in comps} for i, k in enumerate(keys)}
        for v, fn in variants.items():
            r = replay_clip(frames, hands, lambda w, key: fn(cache[key]))
            r.update(truth=truth, clip=os.path.basename(path))
            rows[v].append(r)
        if n % 50 == 0:
            print(f"[replay] {n}/{len(files)} clips", flush=True)

    summary = {}
    for v, rs in rows.items():
        n = len(rs)
        right = sum(r["pred"] == r["truth"] for r in rs)
        none = sum(r["pred"] is None for r in rs)
        wrong = n - right - none
        conf = Counter((labels[r["truth"]], labels[r["pred"]]) for r in rs
                       if r["pred"] is not None and r["pred"] != r["truth"])
        per_word = {}
        for r in rs:
            per_word.setdefault(labels[r["truth"]], []).append(r["pred"] == r["truth"])
        summary[v] = {
            "clips": n, "right": right / n, "wrong": wrong / n, "nothing": none / n,
            "top_wrong": [f"{c}x {t} -> {p}" for (t, p), c in conf.most_common(8)],
            "worst_words": sorted(((w, round(float(np.mean(x)), 2)) for w, x in per_word.items()),
                                  key=lambda kv: kv[1])[:10],
        }
    print(f"\n{'variant':<30} {'right':>6} {'WRONG':>6} {'nothing':>8}   ({len(rows['lstm'])} clips)")
    for v, s in sorted(summary.items(), key=lambda kv: -kv[1]["right"]):
        print(f"{v:<30} {s['right'] * 100:5.1f}% {s['wrong'] * 100:5.1f}% {s['nothing'] * 100:7.1f}%")
    json.dump(summary, open(args.out, "w"), indent=1)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
