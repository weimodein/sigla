# Letters accuracy — design

Date: 2026-10-11. Status: approved for planning, implementation gated on the
offline experiment (plan Phase 0).

## Problem

Letters mode runs fingerspelling through the words pipeline: one LSTM over a
30-frame window of 147 features (2 hands + 7 upper-body points). That pipeline
was built for moving word signs, and five of its rules work against held
letters:

1. Training windows are centred on the fastest movement in the clip
   (`center_on_peak_velocity`). For a raise → hold → lower letter clip that is
   the raise or the lower, so the model mostly learns how the hand got there,
   not the handshape.
2. Live inference refuses windows with too little movement
   (`hasSufficientMotion`, `MIN_SEQUENCE_MOTION = 0.50`). A held letter is
   exactly that, so a letter only fires on the raise or when the hand leaves.
3. 24 of 30 frames must contain the upper body (`hasSufficientPoseCoverage`).
   Close-up fingerspelling silently never fires.
4. The deployed letters model knows 5 classes (F, M, S, T, W) although
   `datasets/LETTERS(*)` holds all 26 letters, 4 signers, ~40 clips each.
5. One training sample per clip, where the hold alone holds 10-15 usable
   handshape frames.

The hackathon project Senya (same team, `hackathon/project-senya`) recognises
letters with a per-frame hand-shape classifier plus a small motion model for
J and Z, and feels more accurate. This design brings that approach into SigLa
without changing any screen.

## Hard constraint

**No UI change.** The translator screen keeps its result card, Filipino line,
progress ring, Words/Letters chips, Tap/Live modes and messages. The admin panel
is unchanged. Everything below is behind those.

## Design

### Two letter models in one file

The letters `.tflite` becomes one file with two TFLite signatures:

| Signature | Input | Output |
|---|---|---|
| `static` | `landmarks` float32[1, 63] | `probabilities` float32[1, N] |
| `motion` | `frames` float32[1, 32, 63] | `probabilities` float32[1, N + 1] |

`N` is the number of letters, in the order of `labels_motion.json`
(`{"0": "A", …}`, unchanged format, so backend deploy validation is unchanged).
`static` puts exactly 0 on motion-only letters (J, Z). `motion` puts exactly 0 on
static letters, and its last column is `_none` ("movement that is not a
letter"), which is never shown.

Inputs are one hand, 21 points × (x, y, z), **raw MediaPipe image coordinates
with x and z multiplied by width / height** (so x and y share one unit).
Normalisation is inside the models: subtract the wrist (point 0), divide by the
hand size (largest 2D distance from the wrist); the motion model uses frame 0's
wrist and size for every frame, which keeps the path of the movement.

The app detects the new format by the presence of both signature keys. Any
other letters file goes down the existing LSTM path untouched.

### Which hand

The signing hand is the detected hand with the largest 2D extent after the
aspect correction (closest to the camera). Training extraction and the app
use the same rule (`select_hand` / `LetterHand.select`).

### Training data

Extraction stores, for letter words only, a `hand_track` per clip: every frame
at up to 24 fps over the signing span, `{t_ms, hand: 63 floats | null}`,
selected and aspect-corrected as above. Tracking runs in MediaPipe VIDEO mode
like the live camera.

- Static letters: frames from the hold (longest-still, highest run, trimmed
  100 ms each end), one every 100 ms, at most 40 per clip.
- J and Z: the one movement in each raise → sign → lower clip
  (`find_single_take`), resampled to 32 frames.
- `_none`: the raise and lower of J/Z clips plus every movement segment found
  in static-letter clips.
- Augmentation: mirror, ±15° rotation, ±10 % scale, noise; time warp for
  sequences.
- Epochs chosen on one held-out signer, then refit on all signers (the same
  pattern `train.py` already uses). `selection_metrics.json` is written so the
  admin Test button keeps working unchanged.

### Live recognition (letters mode only)

Per frame: classify the hand with `static`; feed the hand to a motion
segmenter. A letter is committed when 8 of the last 10 frames agree at
≥ 0.70 confidence while the hand is not moving. The same letter cannot commit
twice in a row until another letter commits or the hand leaves. When the
segmenter closes a movement, `motion` classifies it; J or Z at ≥ 0.70 commits,
and if the letter just committed was its start shape (I for J) within 1 s, the
new letter replaces it (the result card swaps, history replaces the entry).
The existing 2 s gap between results stays for static letters. The progress
ring shows vote progress (agreeing frames / 8). No pose, no motion-energy
gate, no 36-frame wait.

Pose detection is switched off while letters mode is active (faster frames).

Tap mode for letters runs the recorded frames through the same engine and
shows the last committed letter.

### Backend

- New nullable column `gesture_samples.hand_track` (JSONB), migration 008.
- Upload asks the ML service for a hand track only for words whose
  `vocabulary` is `letters`, and stores it.
- `/api/ml/dataset?hand_track=1` adds `hand_track` to each sample.
- `/train` requests carry `model_kind`, so the ML service knows which pipeline
  to run.

### Rollout

Existing letter samples have no hand track, so letter clips are re-imported.
The new letters model is deployed only after the new APK is on the test
devices: an older APK sees an unfamiliar letters file, refuses it, and hides
the Letters chip (words keep working).

## Go / no-go gate

Before any production change, an offline leave-one-signer-out experiment on the
local clips must show:

- mean clip accuracy on F, M, S, T, W ≥ 0.94 (the deployed LSTM's held-out
  score), and
- mean clip accuracy over all 26 letters ≥ 0.90, with no letter below 0.70.

If it fails, stop and report; nothing in production has changed.

## Out of scope

Spaces between words, a transcript strip, any admin change, words-model
changes, Ñ and NG.
