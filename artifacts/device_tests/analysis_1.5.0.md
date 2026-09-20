# 1.5.0 — device test vs cross-validation

Pairs `device_test_1.5.0.csv` (one signer, one take per word, on the deployed
app) against `../cv/cv_40class.json` (4-fold signer-grouped cross-validation over
the same 1417 samples). The point of running both is that they fail differently:
CV measures whether the model can separate two classes at all, the device test
measures whether the whole live pipeline delivers that separation in someone's
hand.

## Headline

    cross-validated   87.7% +/- 1.0%   (4 folds, one held-out signer each)
    per fold          88.1 / 88.5 / 86.0 / 88.2
    on device         32/40 correct (80%)

+/- 1.0% is the tightest spread of the project (30 classes was +/- 1.7%,
20 classes +/- 4.1%), and accuracy went UP from 87.4% at 30 classes despite ten
more ways to be wrong. Adding DAYS did not cost generalisation.

The 80% live figure is not comparable to 87.7% and should not be read as a
regression. CV hands the model a clean, pre-windowed 30-frame sequence; live
inference has to find that window in a stream and only speaks when it clears
MOTION_THRESHOLD (0.80) and MOTION_MIN_MARGIN (0.15).

## The eight device failures split cleanly in two

| word            | device output | CV recall | reading                |
|-----------------|---------------|-----------|------------------------|
| TEN             | Tomorrow      |    38%    | real class overlap     |
| GOOD AFTERNOON  | No Detect     |    48%    | real class overlap     |
| GOOD EVENING    | No Detect     |    75%    | partly real            |
| THREE           | No            |   100%    | live-path only         |
| FOUR            | Wednesday     |    98%    | live-path only         |
| FIVE            | Friday        |    96%    | live-path only         |
| NINE            | Friday        |    95%    | live-path only         |
| SATURDAY        | No Detect     |   100%    | live-path only         |

    mean CV recall, device-PASS words: 88.8% (n=32)
    mean CV recall, device-FAIL words: 81.1% (n=8)

Five of the eight failures sit at 95-100% offline. The model separates those
classes cleanly on held-out signers, so **more clips of them will not help** —
whatever went wrong was in the live path (window selection on a growing buffer,
framing, or simply one unlucky take of a one-take-per-word test).

That is the question this comparison existed to answer, and the answer is:
mostly not a data problem.

## What IS a data problem

Two pairs reproduce offline and dominate the error budget:

    21x  GOOD AFTERNOON -> GOOD EVENING      (+10x reverse)
    18x  TOMORROW       -> TEN               (+13x reverse)
    14x  SIX            -> WEDNESDAY
    11x  SIX            -> TWO
     6x  ONE            -> FAST
     5x  IM FINE        -> FIVE

`TOMORROW <-> TEN` is new at 40 classes and is the number-vs-day interference
predicted when DAYS was imported — FSL day signs commonly carry number
handshapes. It is mutual (18x one way, 13x the other), which means genuine
overlap rather than one class swamping another.

`SIX` at 24.4% mean recall is now the weakest class in the dataset, splitting
between WEDNESDAY and TWO. It happened to PASS on device — a reminder that one
take per word cannot distinguish a 24% class from a 100% one.

`GOOD AFTERNOON <-> GOOD EVENING` has been the largest single error source in
every CV run since the 10-class model. Its device behaviour (silence, not a
wrong word) is the 0.80/0.15 thresholds working as designed.

## Precision caveat on both numbers

Per-class std is very large on exactly the weak classes — SIX +/- 36.7,
TEN +/- 41.5, TOMORROW +/- 44.4 — meaning one signer fails almost completely
while others succeed. A per-class recall here is an average of four very
different numbers, not a stable estimate.

The device test is one signer, one take per word. Neither measurement is
reliable at the level of an individual word; they agree on the shape of the
problem, not on precise per-word rates.

## Recommended next collection

Targeted, not general. Record only:

  * TOMORROW / TEN
  * SIX / WEDNESDAY / TWO
  * GOOD AFTERNOON / GOOD EVENING

ideally from NEW signers, since the discriminating detail is what varies between
people. Do not record more THREE, FOUR, FIVE, NINE or SATURDAY — they are
already at 95-100% and their device failures were not data-driven.
