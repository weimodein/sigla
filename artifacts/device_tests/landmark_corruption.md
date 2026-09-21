# Landmark corruption — correctly normalized garbage

2.28% of stored hand-frames (1409 of 61839) contain landmarks scaled roughly
100x too large. They pass every existing quality gate, because the output is not
malformed — it is a correct normalization of a bad detection. Per-class numbers
are in `landmark_corruption.json`.

Found while investigating why `scripts/separability.py` disagreed with
`separability_50class.json`; that disagreement is still unexplained, and this is
not its cause.

## The mechanism

`normalize_frame` centres each hand on the wrist and divides all 21 landmarks by
the 2D wrist→middle-finger-MCP distance:

    d = sqrt((mx-wx)^2 + (my-wy)^2)
    if d < 1e-6: d = 1e-6
    out[j] = (block[j] - wrist) / d

The epsilon guards against an exactly degenerate hand. It does nothing about a
merely SMALL one. When MediaPipe returns a collapsed hand — wrist and MCP9
almost coincident — `d` lands around 0.01 and every landmark is multiplied by
about 100.

What makes this invisible is that the result is still perfectly normalized. On
the worst frame in the dataset (HOW ARE YOU, sample 1883, frame 11) the wrist
sits at exactly (0.00, 0.00) and |wrist→MCP9| is exactly 1.000. Both invariants
hold. The frame is simply 80x too big:

    normal frame     xy-extent  1.2 hand-widths,  z-extent 0.5
    corrupted frame  xy-extent 96.5 hand-widths,  z-extent 112.1

A hand is about one hand-width across by construction, so xy-extent is the
tell — nothing else downstream looks at absolute scale.

## Where it lands

Concentrated, not spread evenly. Worst classes by share of corrupted
hand-frames:

| class          | corrupted | within-class spread |
|----------------|-----------|---------------------|
| TODAY          | 31.8%     | 180.3               |
| SLOW           | 18.6%     | 117.4               |
| GOOD EVENING   |  8.8%     |  67.6               |
| GOOD AFTERNOON |  8.1%     |  77.7               |
| CORRECT        |  7.2%     | 107.2               |
| TOMORROW       |  4.5%     |  44.6               |

Median within-class spread across all 52 classes is 21.5, so TODAY sits at 8.4x
the median and SLOW at 5.5x. The ranking of the widest-spread classes and the
ranking of the most-corrupted classes are nearly the same list, which is the
clearest signal that the corruption is what inflates them.

## Not train/serve skew

`HandLandmarkHelper.kt` normalizeHandBlock has the identical 2D divisor and the
identical `1e-6` clamp, so the phone does exactly the same thing live. The
parity the codebase maintains is intact; both sides share the blind spot. That
means fixing one side alone WOULD introduce skew, so a fix has to land in both.

## What this does NOT explain

Two things were tested against it and came back negative. Both are worth
recording so they are not re-investigated.

**TOMORROW ↔ TEN is not caused by corruption.** The method doc names this as the
40-class model's confusion pair, and both classes carry corrupted samples, so it
looked like a likely cause. Removing every flagged row moves the pair from 1.09
to 1.10. The signs are genuinely similar; no amount of cleaning changes that,
and only re-recording or accepting the confusion will.

**Separability cannot see this damage.** Removing the flagged rows cuts
within-class spread hard — HOW ARE YOU by 29%, TOMORROW by 21%, TEN by 17%,
SLOW by 14% — while barely moving any ratio. The artifacts inflate the
between-class term proportionally, so `between/within` stays put. A category can
score healthily on separability while a third of its frames are garbage, which
is worth remembering before treating that number as a data-quality check. It
measures whether classes are DISTINGUISHABLE, not whether they are CLEAN.

## The fix, and why it is not applied here

Reject a frame whose post-normalization hand extent exceeds about 5 hand-widths,
and drop it the way a hands-less frame is already dropped in `extract.py` — it
then counts toward the coverage and consecutive-gap gates, which decide whether
the clip survives. That reuses thresholds already tuned rather than inventing a
second policy, and it scales correctly: TODAY 2197 (19 of 30 frames bad) would
fail coverage outright, while a clip with two bad frames would quietly lose them
and pass.

It has to go into `HandLandmarkHelper.kt` at the same time to keep parity, and
that changes live inference — a frame that is classified today would start being
discarded, and enough of them trips NO_HAND_TIMEOUT and resets the buffer. So
the full scope is: guard both sides, re-extract the affected clips from their
source videos, retrain, and re-run the device test. Re-extraction rather than
re-recording is enough, since the source clips are fine; it is the extraction
that damages them.

Deleting the 27 worst rows was considered and rejected as insufficient — that is
the tail where a whole sequence's norm crosses a crude threshold, and it reaches
under 2% of the 1409 corrupted frames. Most damaged clips carry a handful of bad
frames without standing out at sequence level.
