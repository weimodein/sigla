# Separability check — predicting trainability before training

A few minutes of arithmetic on already-stored samples that predicts whether a
newly imported category will train well, instead of spending 1-2 hours on
cross-validation to find out. Numbers for the current 50-class dataset are in
`separability_50class.json`.

## What it measures

For a group of classes, two quantities over the normalized 30x147 sequences:

  within-class spread     how far two takes of the SAME sign sit from each other
  between-class distance  how far two DIFFERENT signs sit from each other

The ratio `between / within` is the useful number. Above ~1.0 the classes are
further from each other than a sign is from itself, and a model can separate
them. Below it, the classes physically overlap in feature space and no amount of
architecture work will fix it — only re-recording will.

## Track record

| category | ratio | what happened |
|----------|-------|---------------|
| DAYS     | 1.38  | trained; best category in the dataset |
| NUMBERS  | 1.15  | trained to ~90% mean recall |
| FAMILY   | 1.14  | predicted good (see caveat below) |
| GREETING | 1.00  | trained to ~86% |
| MONTHS   | 0.38  | FAILED — 45% recall, samples deleted |

The months entry is why this check exists. Their clips were not signed
consistently take-to-take, so two recordings of MARCH were 2.6x further apart
than MARCH and MAY were from each other. That was visible in the numbers before
any training ran, and would have saved the whole 42-class detour.

## The caveat: a category average hides bad pairs

FAMILY scores 1.14 overall, which reads as healthy. Per-pair, it is not uniform:

    SON         vs DAUGHTER       0.33   <- worse than the MONTHS average
    MOTHER      vs PARENTS        0.38   <- matches MONTHS exactly
    FATHER      vs PARENTS        0.64
    FATHER      vs MOTHER         0.70
    GRANDFATHER vs GRANDMOTHER    0.70

So the expectation for FAMILY is not "all good" but "most good, with SON,
DAUGHTER and PARENTS confusing each other" — the same shape as TOMORROW <-> TEN
in the 40-class model. Unlike MONTHS, it is 3-4 weak classes out of 10 rather
than a whole category, so it should not drag the rest down.

Always look at the pairs, not just the category mean.

## A prediction this check got wrong

Before running it I expected FATHER/GRANDFATHER and MOTHER/GRANDMOTHER to be the
risky pairs, reasoning that FSL builds grandparent signs compositionally from the
parent sign. Both came out fine — 1.22 and 1.78, the latter among the best-separated
pairs in the category. The grandparent modifier evidently changes the trajectory
more than the gender distinction does, which is the opposite of the intuition.

Worth remembering that linguistic intuition about which signs "look similar" is
not a reliable substitute for measuring it.

## How to run it

`sigla-ml/scripts/separability.py`, which needs the backend running for
`fetch_approved_samples`. It reports per-pair ratios, and per-pair signer counts
with a warning when two classes were recorded by different numbers of signers —
a class with fewer carries less inter-signer variation in its within-class
spread, so its ratios read optimistically.

The numbers above predate that script and came from inline code in the session
that produced `separability_50class.json`.

**The two do not agree, and the reason is not known.** The script reports DAYS
at 1.62 where the table above says 1.38, and FAMILY at 1.35 against 1.14.
`between/within` reproduces the published ratios exactly, so the formula is not
the difference; aggregation method (per-class mean, pooled pairwise, centroid),
silhouette scoring, dataset drift, re-normalization, excluded samples,
within-signer scoping and landmark corruption have all been tested and ruled
out. Until someone explains it, read the script's output as RELATIVE — pair
against pair, within one run — and do not compare it to the ~1.0 threshold in
this document, which was calibrated on the other scale.

## What this check cannot see

It measures whether classes are DISTINGUISHABLE, not whether they are CLEAN. See
`landmark_corruption.md`: 2.28% of stored hand-frames carry landmarks scaled
~100x by a near-zero normalization divisor, and removing them cuts within-class
spread by 14-29% while barely moving any ratio, because they inflate the
between-class term in the same proportion. TODAY scores acceptably here with a
third of its hand-frames corrupted.
