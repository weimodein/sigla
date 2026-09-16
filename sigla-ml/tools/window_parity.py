"""
Window-selection parity harness — measures whether the 30 frames the PHONE selects
match the 30 frames that were STORED for training.

WHY THIS EXISTS
---------------
tests/test_parity.py and FeatureParityTest.kt already prove that Python's
peak_velocity_index and Kotlin's peakVelocityIndex agree. That is a necessary
check, and it is not the one that matters most.

Both are fed the SAME sequence in those tests. Live they are not:

  * EXTRACTION (extract.py) samples a clean clip at a fixed rate, drops hands-less
    frames, resamples above SEQUENCE_LENGTH, and calls center_on_peak_velocity
    ONCE with force=True. The stored row is the chosen window.
  * TRAINING (preprocessor._load_real_sequences) re-windows that stored row with
    force=False — a verified no-op at exactly SEQUENCE_LENGTH frames. So the model
    only ever trains on the window extraction picked.
  * LIVE (PredictionService.extractMotionWindow) re-runs the search on a GROWING
    buffer of 36..90 frames, every MOTION_SLIDE_INTERVAL frames, and classifies
    whichever window that search returns at that instant.

So matching FUNCTIONS do not imply matching WINDOWS. A clip stored centred on its
gesture can still be classified live on a window centred somewhere else, and
nothing in the suite measures that gap. It shows up only as live accuracy that
does not reproduce the offline number.

WHAT IT MEASURES
----------------
For each stored sample, replay it as the phone would see it — feeding frames one
at a time and, at each point where PredictionService would actually run inference,
asking extractMotionWindow which 30 frames it would hand the model. Compare that
window against the stored one.

Reported per clip:
  * offset      — frame shift between the live window and the stored window, at the
                  first point the phone is allowed to EMIT (>= MIN_COMPLETE_GESTURE_FRAMES)
  * settled     — whether the live window stops moving before the buffer ends, and
                  at what frame count it settles
  * final_match — whether the window at end-of-gesture equals the stored window

A healthy pipeline settles early and ends at offset 0. Large or unsettled offsets
mean the model is being asked to classify a different slice of the gesture than the
one it was trained on.

IMPORTANT — READ BEFORE TRUSTING A NUMBER
-----------------------------------------
Stored rows are already windowed to exactly SEQUENCE_LENGTH frames, so replaying
one directly is vacuous: the buffer never reaches MIN_COMPLETE_GESTURE_FRAMES (36)
and every offset is 0 by construction. To measure anything real, this harness
SYNTHESIZES the entry/exit motion the phone sees and extraction trimmed away — see
synthesize_live_buffer, which is the harness's one modelling assumption.

Consequences:
  * It measures the RE-WINDOWING gap (the live search re-running on a longer
    buffer), NOT the sampling gap (camera cadence vs. extraction cadence).
  * Absolute offsets depend on how much entry motion is assumed via --lead.
    Sweep it; the TREND is the signal, not any single number.
  * Feeding real un-windowed clips would be strictly better. That needs the raw
    recordings re-extracted without the final windowing step, which the current
    extract.py does not emit — a worthwhile follow-up.

USAGE
    python tools/window_parity.py                     # all approved samples
    python tools/window_parity.py --limit 50          # quick pass
    python tools/window_parity.py --lead 6 --lead-sweep
    python tools/window_parity.py --json report.json  # machine-readable
    python tools/window_parity.py --verbose           # per-clip lines

Requires the backend to be reachable (same ML_API_KEY / BACKEND_URL as training).
"""

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    _POSE_BASE,
    _POSE_LWRIST,
    _POSE_RWRIST,
    fetch_approved_samples,
    normalize_sequence,
    peak_velocity_index,
)

# ── Mirrored from PredictionService.kt ───────────────────────────────────────
# These are the live firing constants. They are duplicated here rather than
# imported because they live in Kotlin; tests/test_mobile_parity_flags.py is what
# keeps a copy like this from drifting, so any change here belongs there too.
MIN_MOTION_FRAMES = 12              # inference may RUN from here
MIN_COMPLETE_GESTURE_FRAMES = 36    # mid-gesture emission gate
MOTION_SLIDE_INTERVAL = 2           # re-run every N frames
BUFFER_CAPACITY = 90


def extract_motion_window_live(frames: list[np.ndarray]) -> tuple[int, int]:
    """
    Port of PredictionService.extractMotionWindow — returns the (start, end) the
    phone would select from `frames`.

    Returns indices rather than the window itself so the caller can compare
    POSITIONS, which is what the divergence is about. Mirrors the Kotlin branch
    structure exactly, including the `size == SEQUENCE_LENGTH` identity return and
    the short-buffer padding case.
    """
    n = len(frames)
    if n == SEQUENCE_LENGTH:
        return 0, SEQUENCE_LENGTH
    if n < SEQUENCE_LENGTH:
        # Padded by repeating the last frame — the window starts at 0 and the
        # remainder is frozen padding.
        return 0, n

    peak_idx = peak_velocity_index(np.array(frames, dtype=np.float32))
    half = SEQUENCE_LENGTH // 2
    start = max(peak_idx - half, 0)
    end = start + SEQUENCE_LENGTH
    if end > n:
        end = n
        start = max(end - SEQUENCE_LENGTH, 0)
    return start, end


def synthesize_live_buffer(stored: np.ndarray, lead: int, tail: int,
                           rng: np.random.Generator) -> tuple[np.ndarray, int]:
    """
    Build a plausible LIVE buffer around a stored training window.

    This is the crux of the harness, and its one real assumption.

    A stored row is exactly SEQUENCE_LENGTH frames — already windowed by
    extract.py. Replaying it directly is vacuous: the buffer can never exceed
    MIN_COMPLETE_GESTURE_FRAMES (36), so the phone would never be allowed to emit
    and the measured offset is always 0 by construction. (Verified: a 30-frame
    replay yields first_emit_offset=None.)

    Live, the phone does NOT see a pre-trimmed gesture. It sees the signer raising
    their hands, making the sign, then lowering them — the "raise, sign, lower"
    pattern documented on peak_velocity_index, where the ENTRY spike is ~2.3x the
    gesture's own peak. Extraction's edge margin removes that entry motion; the
    live buffer still contains it.

    So we reconstruct that context: `lead` frames of entry motion before the stored
    window and `tail` frames of exit motion after it. Both are built by extrapolating
    from the window's own edge frames and adding movement toward/away from it, so the
    synthetic frames carry velocity of the same order as the real gesture rather than
    being frozen copies (which would read as zero velocity and bias the search).

    Returns (buffer, offset_of_stored_window_within_buffer) — the offset is `lead`,
    and is the reference the live search must reproduce to be in parity.

    LIMITATION, stated plainly: this measures the RE-WINDOWING gap (the live search
    re-running on a longer buffer) under a modelled entry/exit. It does not measure
    the SAMPLING gap (camera cadence vs. extraction cadence), and the absolute
    numbers depend on how much entry motion is assumed. Treat the trend across
    --lead values as the signal, not any single number.
    """
    first, last = stored[0], stored[-1]

    def drift(anchor: np.ndarray, count: int, outward: bool) -> list[np.ndarray]:
        out = []
        for k in range(count):
            # Distance from the window edge, 1.0 at the far end of the lead-in.
            t = (count - k) / max(count, 1) if not outward else (k + 1) / max(count, 1)
            f = anchor.copy()
            # Move the POSE WRISTS — the signal frame_velocity actually reads.
            # Scaled so the entry excursion is comparable to the gesture's own
            # range, reproducing the documented "entry spike is bigger" shape.
            for w in (_POSE_LWRIST, _POSE_RWRIST):
                base = _POSE_BASE + w * 3
                if np.any(anchor[_POSE_BASE:_POSE_BASE + 21]):
                    f[base] = anchor[base] - t * 1.5
                    f[base + 1] = anchor[base + 1] + t * 1.5
            f += rng.normal(0, 0.002, f.shape).astype(np.float32)
            out.append(f.astype(np.float32))
        return out

    lead_frames = drift(first, lead, outward=False)
    tail_frames = drift(last, tail, outward=True)
    buffer = np.array(lead_frames + list(stored) + tail_frames, dtype=np.float32)
    return buffer, lead


def replay_clip(stored: np.ndarray, reference_offset: int = 0) -> dict:
    """
    Replay a buffer as the phone would consume it.

    `stored` is the full live buffer; `reference_offset` is where the true training
    window sits inside it. Offsets are reported relative to that, so 0 means the
    live search reproduced the training window exactly.
    """
    n_stored = len(stored)
    frames: list[np.ndarray] = []
    observations = []          # (buffer_size, start, emitted_allowed)
    frames_since_run = 0

    for i in range(n_stored):
        frames.append(stored[i])
        if len(frames) > BUFFER_CAPACITY:
            frames.pop(0)
        frames_since_run += 1

        if len(frames) < MIN_MOTION_FRAMES or frames_since_run < MOTION_SLIDE_INTERVAL:
            continue
        frames_since_run = 0

        start, _ = extract_motion_window_live(frames)
        observations.append({
            "buffer": len(frames),
            "start": start,
            # The phone may only EMIT once the buffer can be peak-centered; runs
            # before this build the streak but cannot produce a word.
            "emittable": len(frames) >= MIN_COMPLETE_GESTURE_FRAMES,
        })

    if not observations:
        return {"usable": False}

    emittable = [o for o in observations if o["emittable"]]

    # Offset at the FIRST emittable point — the earliest window the phone could
    # actually classify on, and the one most likely to be wrong. Signed distance
    # from the true training-window position.
    first_emit_offset = (
        emittable[0]["start"] - reference_offset if emittable else None
    )

    # Settling: the last buffer size at which the selected start CHANGED. If the
    # window keeps moving until the end, the choice never stabilised.
    settle_at = None
    for idx in range(len(observations) - 1, 0, -1):
        if observations[idx]["start"] != observations[idx - 1]["start"]:
            settle_at = observations[idx]["buffer"]
            break

    final_offset = observations[-1]["start"] - reference_offset

    return {
        "usable": True,
        "observations": len(observations),
        "first_emit_offset": first_emit_offset,
        "final_offset": final_offset,
        "settle_at": settle_at,
        "settled": settle_at is None or settle_at < observations[-1]["buffer"],
        "final_match": final_offset == 0,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--limit", type=int, default=None,
                    help="only replay the first N samples per class")
    ap.add_argument("--lead", type=int, default=12,
                    help="frames of entry ('hands raising') motion synthesized before "
                         "the stored window (default 12). Sweep this: the TREND across "
                         "values is the signal, not any single number.")
    ap.add_argument("--tail", type=int, default=8,
                    help="frames of exit motion synthesized after the stored window")
    ap.add_argument("--seed", type=int, default=42,
                    help="seed for the synthetic entry/exit jitter")
    ap.add_argument("--lead-sweep", action="store_true",
                    help="re-run across several --lead values and print the trend. "
                         "Preferred over a single run: it shows whether the offset "
                         "tracks the assumed entry motion (a modelling artifact) or "
                         "stays put (a real pipeline gap).")
    ap.add_argument("--json", metavar="PATH",
                    help="write the full report as JSON")
    ap.add_argument("--verbose", action="store_true",
                    help="print a line per clip")
    args = ap.parse_args()

    dataset = fetch_approved_samples()

    if args.lead_sweep:
        return run_sweep(dataset, args)

    stats = measure(dataset, lead=args.lead, tail=args.tail,
                    seed=args.seed, limit=args.limit, verbose=args.verbose)
    return report(stats, args)


def measure(dataset: dict, lead: int, tail: int, seed: int,
            limit: int | None = None, verbose: bool = False) -> dict:
    """Replay every usable sample at one `lead` setting and collect the offsets."""
    rng = np.random.default_rng(seed)

    per_class = {}
    all_first_offsets = []
    all_final_offsets = []
    unsettled = 0
    final_mismatch = 0
    total = 0
    skipped = 0

    for label in sorted(dataset):
        samples = dataset[label]
        if limit:
            samples = samples[:limit]

        offsets = []
        for sample in samples:
            seq = sample.get("sequence")
            if not seq:
                skipped += 1
                continue
            arr = np.array(seq, dtype=np.float32)
            if arr.ndim != 2 or arr.shape[1] != FEATURE_SIZE or not np.isfinite(arr).all():
                skipped += 1
                continue

            # Stored rows are raw landmarks; the live buffer holds NORMALIZED
            # frames (HandLandmarkHelper normalizes each frame as it is captured).
            # Normalize before replaying or the velocity signal is measured in the
            # wrong space and the comparison is meaningless.
            arr = normalize_sequence(arr)

            # Reconstruct the entry/exit context the phone sees but the stored row
            # has already had trimmed away — see synthesize_live_buffer.
            buffer, reference = synthesize_live_buffer(
                arr, lead, tail, rng
            )
            result = replay_clip(buffer, reference_offset=reference)
            if not result["usable"]:
                skipped += 1
                continue

            total += 1
            offsets.append(result)
            if result["first_emit_offset"] is not None:
                all_first_offsets.append(result["first_emit_offset"])
            all_final_offsets.append(result["final_offset"])
            if not result["settled"]:
                unsettled += 1
            if not result["final_match"]:
                final_mismatch += 1

            if verbose:
                print(f"  {label:<24} first_emit_offset="
                      f"{result['first_emit_offset']} final_offset={result['final_offset']} "
                      f"settle_at={result['settle_at']} match={result['final_match']}")

        if offsets:
            per_class[label] = {
                "clips": len(offsets),
                "mean_abs_final_offset": float(
                    np.mean([abs(o["final_offset"]) for o in offsets])
                ),
                "final_mismatches": sum(1 for o in offsets if not o["final_match"]),
                "unsettled": sum(1 for o in offsets if not o["settled"]),
            }

    return {
        "total": total,
        "skipped": skipped,
        "per_class": per_class,
        "first_offsets": all_first_offsets,
        "final_offsets": all_final_offsets,
        "unsettled": unsettled,
        "final_mismatch": final_mismatch,
        "lead": lead,
        "tail": tail,
    }


def run_sweep(dataset: dict, args) -> int:
    """
    Measure across several assumed entry lengths.

    This is the honest way to read this harness. If the offset scales with `lead`,
    the number is mostly reporting the synthetic assumption. If it stays roughly
    constant, the live search genuinely lands somewhere other than the training
    window and the gap is real.
    """
    leads = [0, 4, 8, 12, 18, 24]
    print(f"\n{'='*66}")
    print("LEAD SWEEP — offset vs. assumed entry motion")
    print(f"{'='*66}\n")
    print(f"{'lead':>6}  {'clips':>6}  {'mean|off|':>10}  {'exact':>8}  {'unsettled':>10}")
    rows = []
    for lead in leads:
        s = measure(dataset, lead=lead, tail=args.tail, seed=args.seed,
                    limit=args.limit)
        if not s["total"]:
            continue
        ff = np.array(s["final_offsets"])
        row = {
            "lead": lead,
            "clips": s["total"],
            "mean_abs": float(np.abs(ff).mean()),
            "exact": float((ff == 0).mean()),
            "unsettled": s["unsettled"] / s["total"],
        }
        rows.append(row)
        print(f"{lead:>6}  {row['clips']:>6}  {row['mean_abs']:>10.2f}  "
              f"{row['exact']:>7.1%}  {row['unsettled']:>9.1%}")

    if len(rows) >= 2:
        spread = max(r["mean_abs"] for r in rows) - min(r["mean_abs"] for r in rows)
        print(f"\n  mean|offset| spread across leads: {spread:.2f} frames")
        if spread > 3.0:
            print("  -> offset tracks the assumed entry motion; treat absolute values")
            print("     as modelling-dependent and compare runs at a FIXED --lead.")
        else:
            print("  -> offset is largely independent of the assumed entry motion,")
            print("     which points at a genuine re-windowing gap rather than an artifact.")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"sweep": rows}, f, indent=2)
        print(f"\nReport written to {args.json}")
    return 0


def report(stats: dict, args) -> int:
    total = stats["total"]
    skipped = stats["skipped"]
    per_class = stats["per_class"]
    all_first_offsets = stats["first_offsets"]
    all_final_offsets = stats["final_offsets"]
    unsettled = stats["unsettled"]
    final_mismatch = stats["final_mismatch"]

    if not total:
        print("No usable samples replayed.", file=sys.stderr)
        return 1

    print(f"\n{'='*66}")
    print(f"WINDOW-SELECTION PARITY — {total} clips replayed ({skipped} skipped)")
    print(f"{'='*66}\n")

    print("Live window vs. stored training window (signed frame offset; 0 == identical).")
    print("A negative offset means the live search centred EARLIER in the gesture than")
    print("training did — i.e. toward the entry motion.\n")
    if all_first_offsets:
        fo = np.array(all_first_offsets)
        print(f"  at first emittable point (>= {MIN_COMPLETE_GESTURE_FRAMES} frames):")
        print(f"      mean |offset| {np.abs(fo).mean():.2f}  "
              f"median {np.median(fo):+.1f}  range {fo.min():+d}..{fo.max():+d}")
        print(f"      exact match: {int((fo == 0).sum())}/{len(fo)} "
              f"({(fo == 0).mean():.1%})")
    ff = np.array(all_final_offsets)
    print(f"  at end of gesture:")
    print(f"      mean |offset| {np.abs(ff).mean():.2f}  "
          f"median {np.median(ff):+.1f}  range {ff.min():+d}..{ff.max():+d}")
    print(f"      exact match: {int((ff == 0).sum())}/{len(ff)} ({(ff == 0).mean():.1%})")

    print(f"\n  windows that never settled: {unsettled}/{total} ({unsettled/total:.1%})")
    print(f"  final-window mismatches:    {final_mismatch}/{total} "
          f"({final_mismatch/total:.1%})")

    worst = sorted(per_class.items(),
                   key=lambda kv: kv[1]["mean_abs_final_offset"], reverse=True)[:8]
    if worst:
        print("\nWorst classes by mean final offset:")
        for label, stats in worst:
            print(f"  {label:<28} |offset| {stats['mean_abs_final_offset']:>5.2f}  "
                  f"mismatch {stats['final_mismatches']}/{stats['clips']}  "
                  f"unsettled {stats['unsettled']}")

    print("\nHow to read this:")
    print("  A nonzero offset means the phone classifies a DIFFERENT 30 frames than")
    print("  the ones this clip contributed to training. Matching peak-velocity code")
    print("  on both sides does not prevent that — the two are fed different-length")
    print("  inputs. High 'unsettled' counts mean the window was still moving when")
    print("  the gesture ended, so the fired window was chosen on partial evidence.")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({
                "clips": total,
                "skipped": skipped,
                "first_emit_offset_mean": float(np.mean(all_first_offsets)) if all_first_offsets else None,
                "final_abs_offset_mean": float(np.abs(ff).mean()),
                "final_exact_match_rate": float((ff == 0).mean()),
                "unsettled": unsettled,
                "final_mismatch": final_mismatch,
                "per_class": per_class,
            }, f, indent=2)
        print(f"\nReport written to {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
