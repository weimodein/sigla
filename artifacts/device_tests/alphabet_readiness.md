# Alphabet readiness — will letters collide with the day signs?

The FSL day signs are the first letter of the word plus a circular motion:
MONDAY is the letter M traced in a circle. Adding the alphabet therefore puts
each letter next to a word that shares its handshape and differs only in motion,
which is the one thing that could make both harder to recognize.

This records what was checked before importing, and what turned out not to be a
problem. The pair ratios themselves go in a separate run once the import lands —
see `scripts/separability.py --pairs M:MONDAY ...`.

## The dataset

`datasets/ALPHABETS/<LETTER>/<signer>/` — 798 clips, 26 letters, 10 takes per
signer per letter. All .MOV, 60fps, 3.5-5.5s.

  * signer-01, -02, -03 recorded all 26 letters
  * signer-04 recorded M and V only
  * no duplicate content (md5 across all 798 came back clean)
  * I/signer-02 and Z/signer-02 hold 9 clips rather than 10

The signer folders carry the same ids as the `session_id` values already in the
database, so these are the same people who recorded the words. That matters more
than it looks: it means a letter-vs-word comparison measures the SIGN, not the
person. Letters recorded by three new signers would have confounded the two.

**M having four signers is the useful accident.** M ↔ MONDAY is the pair the
whole question rests on, and it is the one pair that gets a clean 4-signer vs
4-signer comparison. T, W, F and S will be 3 vs 4 and therefore read slightly
optimistic — fewer signers means less inter-signer variation inside the
within-class term, which shrinks the denominator. `separability.py` prints the
signer counts per pair and says so when they differ. A marginal pass on those
four is a warning; a failure is still a failure.

## Two worries that did not survive checking

**Trimming does not crop the circular motion.** The stored window is 30 frames
at TARGET_SAMPLE_FPS 24, so 1.25 seconds, centred on a smoothed and
edge-margined velocity peak. A day sign's circle fits inside that comfortably.
There is also a helpful asymmetry: a held letter has no velocity peak, so M and
MONDAY get their windows aligned to genuinely different events rather than
collapsing onto the same frames.

**Static letters clear the motion gate easily.** MIN_SEQUENCE_MOTION is 0.50 and
the expectation was that a held handshape would fail it. Measured on real clips,
motion energy runs 0.96 to 1.92 — roughly 3x the floor. Natural hand drift is
more than enough. Sixteen sampled clips across M/T/W/F/S extracted with zero
rejections, against 95% acceptance on the DAYS import.

## One real difference from the words

99% of letter clips exceed the 86-frame sampling budget, against 48% for
MONDAY's own clips. They are longer on average (median 4.4s vs 3.6s) and all
60fps, so at 24fps they would need ~105 samples, hit the ceiling, and fall back
to even spreading at ~19.6fps effective.

`extract.py` already logs this and the comment there explains the cost: the
stored window stops being comparable to what the phone feeds live inference.
Accepted as-is for this import, on the grounds that the words already carry the
same effect to a lesser degree and consistency between them matters more than
either being ideal. Worth revisiting if the letter ratios come back marginal,
since it is a confound sitting directly under the comparison.

## Importing

`scripts/import_alphabets.py`, one batch per (letter, signer). The shape is
forced by the endpoint rather than chosen: upload-videos caps a batch at 50
files, REQUIRES session_id as the cross-validation grouping key, and answers 202
before extracting in the background while refusing a concurrent batch for the
same word with 409.

A per-clip loop therefore gets 409 on everything after the first and loses it
silently. The script uploads a folder at a time and waits for each job to leave
`processing` before the next batch on that word.

Two failures worth keeping in mind, both hit on the first run:

  * A dropped connection while POLLING killed the run on its first batch while
    the backend happily finished that batch alone. The job is detached from the
    request, so losing the socket costs only the status update. Polling now
    retries on transport errors; the UPLOAD deliberately does not, since the
    server may already have accepted the batch and a retry would duplicate it.
  * Recovery needs to count stored samples per signer, not check whether the
    signer appears at all. The crash left a partial batch of 5 of 10, and
    "signer is present" would have silently abandoned the other half.
