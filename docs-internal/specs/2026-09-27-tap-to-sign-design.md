# Tap-to-Sign Translation Mode — Design

**Date:** 2026-09-27
**Status:** Approved in design review, pending spec review
**Area:** sigla-mobile (primary), sigla-ml (parity refactor only)

## 1. Goal

Add a **Tap** translation mode beside the existing realtime (**Live**) mode. In Tap
mode the user taps a button, the signer performs one sign, and the app classifies
that single recorded sign with the existing TFLite model.

The model is a classifier: it returns a probability per word. Tap mode does not
compare against stored reference landmarks; it runs the same model on a better
input.

### Why

Live mode must guess where a sign starts and ends from a continuous stream. Most of
`PredictionService.kt` — the sliding 30-frame window, early-fire streaks,
confidence tiers, shared-opening defenses, the no-hands flush — exists to make that
guess, and live misfires come from guessing wrong.

Tap mode gets the boundaries from the signer instead. Because it holds the whole
clip, it can prepare the model input the same way training clips were prepared in
`sigla-ml/app/services/extract.py` (trim → 24 fps → drop hand-less frames →
quality gates → peak-velocity window). Live mode cannot, since it never sees a
complete clip. Matching the training pipeline is the expected source of the
accuracy gain.

### Usage context

The phone is usually on a stand or held by another person, so the signer often
cannot reach the screen. Signers rest their hands **out of frame** between signs.

## 2. Decisions

| Topic | Decision |
|---|---|
| Purpose | Push-to-translate (not a practice/check mode) |
| Start | Tap arms the mode; recording begins when hands appear |
| Stop | Automatic when hands drop out of frame; a tap also stops; 4 s cap |
| After result | Return to Idle; every sign needs a new tap (no auto re-arm) |
| Signs too short for training parity | Reject with a "too quick" message (no padding) |
| Clip preparation | On-device, mirroring `extract.py` step by step |
| Mode switch | Third toggle, **Live / Tap**, in the existing toggle row |
| Default | **Tap** on fresh installs; choice persisted in `AppSettings` |
| Relationship to Live | Live is kept unchanged as the alternative mode |

## 3. The tap cycle (state machine)

| State | Screen | Transitions |
|---|---|---|
| **Idle** | "Tap to sign" button; last result stays visible | Tap → Ready |
| **Ready** | "Ready — start signing" (pulsing outline) | First usable hand frame → Recording. No usable hand within **5 s** → Idle with "No hands seen". Tap → Idle (cancel) |
| **Recording** | Red button, ring filling toward the cap, elapsed time | **6 consecutive** frames without a usable hand → Processing. Tap → Processing (manual stop). Elapsed ≥ **4 s** → Processing |
| **Processing** | Spinner (target < 1 s) | Result or rejection message → Idle |

- "Usable hand" means the same test Live mode applies: a detected hand that passes
  `handExtentOk` (a collapsed MediaPipe detection counts as no hand).
- The 6-frame stop matches `NO_HAND_TIMEOUT` in `PredictionService` and the
  0.25 s `MAX_MISSING_HAND_SECONDS` gate in `extract.py`, so all three agree on
  when a sign has ended.
- While Recording, every camera frame is kept as
  `(timestampMs, features: FloatArray, usableHand: Boolean)`; pose presence is
  read from the features with `posePresent`, as Live mode does.
  The features are already normalized per frame by `HandLandmarkHelper`, which is
  the order `extract.py` uses (normalize before windowing).
- **Cancel to Idle** (discarding the recording) on: Live/Tap switch, Words/Letters
  switch, camera flip, or the activity pausing/stopping.

## 4. Clip preparation (`ClipPreparer`)

A pure Kotlin unit: no Android, camera, or UI dependencies. Input: the recorded
frame list. Output: either a 30-frame window or a typed rejection. The steps and
constants mirror `extract.py`:

1. **Trim** to `[firstHandFrame − 4, lastHandFrame + 4]` (`TRIM_PAD_FRAMES = 4`). The
   trailing pad is capped at `floor(0.25 s × fps)` frames so that below 16 fps the pad
   alone cannot trip the hand-gap gate; at 16 fps and above it is exactly 4.
   The phone detects on every frame whereas `extract.py` scans 30 evenly spaced
   frames; the result is equivalent because step 3 drops hand-less frames anyway.
2. **Resample to 24 fps** (`TARGET_SAMPLE_FPS`): measure the recording's frame rate
   from its timestamps, then pick frames with `clip_prep.sample_indices`' exact index
   formula (stride = fps / 24), so the phone and training select the same frames. Fallbacks as in
   training: if the rate-based count is below 30, use every trimmed frame; if it
   exceeds the budget of **86** frames
   (`min(max(60, ceil(30 / 0.35)), 120)`), spread 86 frames evenly.
3. **Drop frames without a usable hand.**
4. **Quality gates** (same thresholds as training), each mapped to a message:

   | Gate | Threshold | Message |
   |---|---|---|
   | Hand coverage (hand frames / sampled frames) | ≥ 0.35 | "Keep your hands in frame" |
   | Pose coverage (pose frames / hand frames) | ≥ 0.75 | "Step back so your shoulders are in view" |
   | Longest hand gap | ≤ 0.25 s | "Keep your hands in frame" (safety net; auto-stop normally prevents it) |
   | Hand frames | ≥ 30 | "Sign was too quick — try again, a little slower" |

5. **Exactly 30 frames → linear interpolation to 60** along the time axis, as in
   `extract.py`, so the window search in step 6 has real choice.
6. **Peak-velocity window**: 30 frames centred on `peakVelocityIndex` (the existing
   Kotlin function, already parity-tested against Python), equivalent to
   `center_on_peak_velocity(force=True)`.
7. **Window checks**: existing `hasSufficientMotion` (`MIN_SEQUENCE_MOTION = 0.50`,
   "No clear movement — try again") and `hasSufficientPoseCoverage`.
8. **Classify** with the model for the current vocabulary (Words or Letters) and
   apply the existing acceptance rules (`MOTION_THRESHOLD = 0.80` plus the top-2
   margin gate). Below that → "Not recognized — try again".

Constants that mirror `extract.py` must be named identically and carry a comment
pointing at their Python counterpart.

## 5. Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `ClipPreparer` (new) | Section 4 steps 1–7; pure function | shared helpers from `PredictionService.kt` (`peakVelocityIndex`, `frameVelocity`, `hasSufficientMotion`, `hasSufficientPoseCoverage`, `posePresent` — the last is currently `private` and becomes `internal`) |
| `TapSignSession` (new) | Section 3 state machine; buffers frames; invokes `ClipPreparer` then classification; injectable clock | `ClipPreparer`, a classifier interface |
| `PredictionService` (small change) | Exposes a one-shot `classifyWindow(window)` that reuses its interpreter, pinned model, labels, and acceptance rules | — (Live behaviour unchanged) |
| `MainActivity` (change) | Mode toggle; routes frames to either `PredictionService.processFrame` (Live) or `TapSignSession` (Tap), never both; renders states; delivers results to the existing result card, Filipino line, TTS, and translation history | the above |
| `AppSettings` (change) | `translationMode` key, default `"tap"` | — |
| `activity_main.xml` (change) | Record button in the camera card; third toggle in the toggle row | — |

`PredictionService.kt` is ~1,150 lines of Live-specific logic; Tap-mode logic
stays out of it apart from `classifyWindow`.

## 6. UI

- **Toggle**: "Live / Tap", styled with the existing `applyToggleStyle`.
- **Record button** (Tap mode only): large, round, bottom-centre of the camera
  view, with the four state appearances in section 3.
- **Hidden in Tap mode**: buffer progress bar, frame count, streak and velocity
  readouts.
- **Results**: same result card, Filipino line, TTS, and history entry as Live.
- **Messages** (rejections, "No hands seen", "Not recognized") go to the status
  line, not the result card, so the last good word remains visible.
- The emergency button is unaffected.

## 7. Testing and parity

1. **Clip-preparation parity (primary).**
   - Refactor the post-detection part of `extract.py` into pure functions
     (sampling indices, hand-less drop, gates, 30→60 stretch, windowing) that
     `extract.py` calls. No behaviour change: verify identical extracted output
     for a set of clips before and after, plus the existing `sigla-ml` tests.
   - Extend `sigla-ml/tools/gen_parity_fixtures.py` to emit tap-mode fixtures
     generated by those real functions: normal sign, fast sign (rejected),
     hand gap, hands present at start, exactly-30 edge case, each rejection reason,
     and variable frame timing (e.g. 24 and 30 fps sources).
   - New Kotlin unit test feeds the same fixtures to `ClipPreparer` and asserts:
     same selected frames, same 30-frame window within float tolerance, and same
     rejection reason.
2. **State machine unit tests** for `TapSignSession` with a fake clock and fake
   frames: Ready→Recording on hands; 5 s no-hands timeout; auto-stop after 6
   hand-less frames; 4 s cap; tap to cancel (Ready) and to stop (Recording);
   cancellation on mode, vocabulary, and camera changes.
3. **Regression**: existing `FeatureParityTest`, `PredictionPolicyTest`,
   `ThresholdPolicyTest`, `OverlayTransformTest`, and the `sigla-ml` test suite
   pass unchanged.
4. **On-device comparison before shipping Tap as default**: the same word set
   (e.g. 10 words × 5 attempts) in Live and Tap; compare accuracy and false
   results. If Tap is not clearly better, the default reverts to Live (one-line
   change).

## 8. Out of scope

- Multiple signs in one recording (sentence translation).
- Auto re-arm after a result.
- Practice/check mode (target word vs prediction).
- Any change to the model, training pipeline behaviour, or backend.
