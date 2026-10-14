"""
Does a "not a sign" class help the words model live? Signer-01 is held out:
both models are trained without it (the none windows come from the other
signers), then signer-01's whole clips are replayed as the phone sees them
(12 fps detection + FrameRateBridge, model every 4 frames, streaks 5/2).

Two measurements per model:
  signs      every real clip: right / wrong / nothing (the none class must not
             cost real words)
  non-signs  the same clips cut to ONLY the movement around the sign — the
             raise (everything from the sign on removed) and the lowering
             (everything up to the end of the sign removed). Nothing should fire;
             every word shown is a false alarm, like the phone's stray I'M FINE.

    venv/Scripts/python.exe tools/none_experiment.py --data dataset.pkl \
        --streams live_streams --none none_windows.npz --out-dir none_exp
"""

import argparse
import glob
import json
import os
import pickle
import sys
import types
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.modules.setdefault("app.utils.supabase_client", types.SimpleNamespace(
    upload_file=None, BUCKET_MODELS="models"))

import live_replay as R  # noqa: E402
from build_none_windows import SIGN_HALF  # noqa: E402

TEST = "signer-01"
CONV_EPOCHS, LINEAR_C = 48, 1.0   # chosen for this fold on signer-02 by words_experiment.py


def train_blend(words: dict, none_samples, out_path: str):
    """The production conv_linear recipe on `words` (+ optional none class)."""
    import tensorflow as tf
    from sklearn.utils.class_weight import compute_class_weight
    from app.services import words_blend as W
    from app.services.train import set_global_seed
    from app.utils.preprocessor import prepare_motion_dataset

    data = dict(words)
    if none_samples:
        data[W.NONE_LABEL] = none_samples
    X, y, _, _, lm, rc = prepare_motion_dataset(data, train_all=True, random_state=42)
    present = np.array(sorted(rc))
    real_y = np.concatenate([np.full(rc[c], c) for c in present])
    cw = dict(zip(present.tolist(), compute_class_weight("balanced", classes=present, y=real_y).tolist()))
    set_global_seed(42)
    conv = W.build_conv(len(lm))
    conv.fit(X, y, epochs=CONV_EPOCHS, batch_size=32, class_weight=cw, verbose=0)
    rx, ry, _ = W.real_arrays(data, lm)
    model = W.compose(W.fit_linear(rx, ry, len(lm), LINEAR_C), conv)
    if none_samples:
        model = W.drop_none(model)
    model.save(out_path)
    tf.keras.backend.clear_session()


def phone_view(frames, hands):
    keep = np.unique(np.floor(np.arange(0, len(hands), 2)).astype(int))
    return R.upsample_stream(frames[keep], hands[keep], 12.0, 24.0)


def sign_bounds(frames, hands):
    from app.utils.preprocessor import peak_velocity_index
    idx = np.where(hands > 0)[0]
    if len(idx) < 2 * SIGN_HALF:
        return None
    peak = idx[0] + peak_velocity_index(frames[idx[0]:idx[-1] + 1])
    return peak - SIGN_HALF, peak + SIGN_HALF


def evaluate(model_path: str, labels: list, streams: list) -> dict:
    import tensorflow as tf
    import app.services.words_blend  # noqa: F401  (custom layers)
    model = tf.keras.models.load_model(model_path, compile=False)
    signs = Counter()
    false = Counter()
    false_words = Counter()
    n_non = 0
    for path in streams:
        z = np.load(path, allow_pickle=True)
        label = str(z["label"])
        if label not in labels:
            continue
        f, h = phone_view(z["frames"], z["hands"])
        variants = [("sign", h)]
        b = sign_bounds(f, h)
        if b:
            raise_only = h.copy()
            raise_only[b[0]:] = 0
            lower_only = h.copy()
            lower_only[:b[1] + 1] = 0
            variants += [("non", raise_only), ("non", lower_only)]
        for kind, hh in variants:
            wins = R.clip_windows(f, hh)
            cache = {}
            if wins:
                keys = list(wins)
                p = model.predict(np.stack([wins[k] for k in keys]), verbose=0, batch_size=256)
                cache = dict(zip(keys, p))
            r = R.replay_clip(f, hh, lambda w, key: cache[key])
            if kind == "sign":
                signs["right" if r["pred"] is not None and labels[r["pred"]] == label
                      else "nothing" if r["pred"] is None else "wrong"] += 1
            else:
                n_non += 1
                if r["pred"] is not None:
                    false["fired"] += 1
                    false_words[labels[r["pred"]]] += 1
    n = sum(signs.values())
    return {
        "signs": {k: round(v / n, 4) for k, v in signs.items()}, "sign_clips": n,
        "false_alarm_rate": round(false["fired"] / max(n_non, 1), 4), "non_sign_clips": n_non,
        "false_alarm_words": false_words.most_common(8),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--streams", required=True, help="signer-01 streams")
    ap.add_argument("--none", required=True, help="none windows .npz (any signers)")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()
    R.MOTION_SLIDE_INTERVAL, R.MOTION_EARLY_STREAK, R.EARLY_EXIT_STREAK = 4, 5, 2

    os.makedirs(args.out_dir, exist_ok=True)
    data = pickle.load(open(args.data, "rb"))
    words = {k: [s for s in v if s.get("sequence")
                 and str(s.get("session_id")).strip().casefold() != TEST]
             for k, v in data.items() if len(k) > 1}
    labels = sorted(words)

    z = np.load(args.none, allow_pickle=True)
    keep = z["signer"] != TEST
    mean_per_word = sum(map(len, words.values())) / len(words)
    cap = int(3.0 * mean_per_word)
    tmp = os.path.join(args.out_dir, "none_train.npz")
    np.savez(tmp, windows=z["windows"][keep], signer=z["signer"][keep])
    from app.services.words_blend import load_none_samples
    none = load_none_samples(tmp, cap)

    results = {}
    for name, ns in (("blend", None), ("blend+none", none)):
        path = os.path.join(args.out_dir, f"{name}.keras")
        if not os.path.exists(path):
            print(f"[none-exp] training {name} ...", flush=True)
            train_blend(words, ns, path)
        print(f"[none-exp] replaying {name} ...", flush=True)
        results[name] = evaluate(path, labels, sorted(glob.glob(os.path.join(args.streams, "*.npz"))))
        print(f"[none-exp] {name}: {json.dumps(results[name])}", flush=True)
    json.dump(results, open(os.path.join(args.out_dir, "results.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
