"""Go/no-go for the letters redesign (spec "Go / no-go gate").

    venv/Scripts/python.exe tools/letters_experiment.py

Leave-one-signer-out on the local track cache, twice: on F, M, S, T, W (the
deployed LSTM's classes, held-out-signer accuracy 0.94 in models/1.9.0-letters)
and on every letter present.
"""
import argparse
import glob
import json
import os
import sys

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)

from app.services.letters_train import LetterSample, leave_one_signer_out  # noqa: E402

BASELINE_LETTERS = ["F", "M", "S", "T", "W"]
BASELINE_ACCURACY = 0.94
GATE_ALL = 0.90
GATE_MIN_LETTER = 0.70


def load(root: str) -> list:
    out = []
    for path in sorted(glob.glob(os.path.join(root, "*", "*", "*.json"))):
        letter, signer = path.split(os.sep)[-3], path.split(os.sep)[-2]
        with open(path, encoding="utf-8") as f:
            out.append(LetterSample(letter, signer, json.load(f)["frames"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", default=os.path.join(ML_ROOT, "letter_tracks"))
    ap.add_argument("--out", default=os.path.join(ML_ROOT, "letters_experiment.json"))
    args = ap.parse_args()
    samples = load(args.tracks)
    if not samples:
        print(f"no tracks in {args.tracks}: run tools/extract_letter_tracks.py first")
        return 2
    labels = sorted({s.label for s in samples})
    print(f"{len(samples)} clips, {len(labels)} letters, signers: "
          f"{sorted({s.group for s in samples})}")

    subset = leave_one_signer_out([s for s in samples if s.label in BASELINE_LETTERS], BASELINE_LETTERS)
    full = leave_one_signer_out(samples, labels)
    worst = min(full["report"]["per_letter"].items(), key=lambda kv: kv[1])
    gate = {
        "subset_mean": subset["mean_accuracy"], "subset_needed": BASELINE_ACCURACY,
        "all_mean": full["mean_accuracy"], "all_needed": GATE_ALL,
        "worst_letter": worst[0], "worst_recall": worst[1], "worst_needed": GATE_MIN_LETTER,
    }
    gate["pass"] = (subset["mean_accuracy"] >= BASELINE_ACCURACY
                    and full["mean_accuracy"] >= GATE_ALL and worst[1] >= GATE_MIN_LETTER)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"gate": gate, "subset": subset, "all": full}, f, indent=2)
    print(json.dumps(gate, indent=2))
    print(full["report"]["top_confusions"])
    print("GATE PASSED" if gate["pass"] else "GATE FAILED — stop and report, change nothing in production")
    return 0 if gate["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
