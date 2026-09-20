# On-device test results

Live results from signing each word into the mobile app against a deployed
model. This is the only number here that measures the whole pipeline — camera
framing, lighting, real-time windowing on a growing buffer, and the confidence
thresholds — rather than offline extraction quality.

Expect live accuracy BELOW the cross-validated figure. Offline CV feeds the
model a clean, pre-windowed 30-frame sequence; live inference has to find that
window itself in a stream, and a prediction only surfaces if it clears
MOTION_THRESHOLD (0.80) and MOTION_MIN_MARGIN (0.15). A word that goes silent
is usually the thresholds working, not the model failing.

## device_test_1.5.0.csv — 2026-09-20

Model `1.5.0`: 40 classes, 1417 samples, 4 signers, mirror augmentation ON
(front-camera support). Reported accuracy 87.5% on one held-out signer.

`result` is `okay` when the app produced the correct word, `not` otherwise;
`output` records what it said instead. The 12 CALENDAR rows are blank because
those words have no samples — they were deliberately excluded after the months
data was found to be inconsistently signed, so the model has no class for them
and the app correctly never emits one.

**32 of 40 deployed classes correct (80%)** against 87.5% offline.

### The 8 failures split into two kinds

Three produced NO output at all:

    GOOD AFTERNOON   No Detect
    GOOD EVENING     No Detect
    SATURDAY         No Detect

GOOD AFTERNOON / GOOD EVENING going silent is the DESIGNED behaviour, not a
regression. That pair has been the single largest error source in every
cross-validation run since the 10-class model (28 of ~76 errors at 20 classes,
30 of ~130 at 30 classes). The 0.80/0.15 thresholds exist so that when the model
cannot separate them it stays quiet rather than firing one as the other — the
safe failure. Lowering the thresholds would turn these two silences into
confident mistakes.

Five produced the WRONG word, and four of those five are a NUMBER answered with
a DAYS word:

    THREE  -> No
    FOUR   -> Wednesday
    FIVE   -> Friday
    NINE   -> Friday
    TEN    -> Tomorrow

That is the interesting result. NUMBER scored ~90% mean recall in the 30-class
cross-validation, which was run BEFORE the DAYS words existed. Adding 10 DAYS
classes appears to have pulled the number classes apart — the same interference
signature seen once before, when adding NUMBER dropped IM FINE from 81% to 51%
via `IM FINE -> FIVE`.

The mechanism is plausible rather than surprising: FSL day signs commonly
incorporate number handshapes, so the two categories share their most
discriminative feature. Note also that 5 of the 10 numbers fail while the DAYS
words themselves are almost all fine (9/10) — the confusion is asymmetric, which
is what you would expect if the day signs carry extra movement that the numbers
lack.

### What this does NOT tell us on its own

A single pass of one signer on one device. It cannot separate:
  * a genuine class-overlap problem (would also show in cross-validation), from
  * a live-only problem such as windowing or threshold behaviour (would not).

**That question is now answered — see analysis_1.5.0.md.** Cross-validation
(87.7% +/- 1.0%) showed five of the eight failures sitting at 95-100% recall
offline, so they are live-path artifacts and more clips of those words would not
help. Only TEN (38%), GOOD AFTERNOON (48%) and partly GOOD EVENING (75%) are
genuine class overlap.

## Files

  device_test_1.5.0.csv      raw per-word results from the app
  analysis_1.5.0.md          device-vs-CV comparison and what to record next
  cv_40class_summary.json    the CV numbers the analysis draws on (the full
                             cv_40class.json lives in ../cv/, which is ignored)
