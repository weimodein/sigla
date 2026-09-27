# Tap vs Live — on-device comparison (2026-09)

Phone: user's test device (installed via `adb`, debug build from Task 6) · Signer: user · Lighting: not recorded

10 words, 5 attempts each, per mode.

| Word | Live correct /5 | Live wrong word | Tap correct /5 | Tap wrong word |
|---|---|---|---|---|
| GOOD AFTERNOON | 5/5 | — | 4/5 | not tracked |
| GOOD EVENING | 4/5 | not tracked | 4/5 | not tracked |
| KNOW | 5/5 | — | 4/5 | not tracked |
| DON'T KNOW | 5/5 | — | 5/5 | — |
| THANK YOU | 5/5 | — | 5/5 | — |
| NO | 5/5 | — | 4/5 | not tracked |
| YES | 4/5 | not tracked | 4/5 | not tracked |
| HELLO | 3/5 | not tracked | 4/5 | not tracked |
| SEE YOU TOMORROW | 4/5 | not tracked | 4/5 | not tracked |
| UNDERSTAND | 5/5 | — | 5/5 | — |

**Totals:** Live 45/50 correct · Tap 44/50 correct

Whether the misses were wrong-word errors or no-result ("not recognized") was not
tracked during this run, so the two modes' failure characters cannot be compared —
only the raw correct-count.

**Decision:** keep Tap as default — as a deliberate override of this document's
own decision rule, not because the rule was satisfied. Recorded plainly below so
this isn't mistaken for the rule having been met.

**By the letter of the plan's rule, Tap did not qualify.** The plan's Task 7
Step 2 sets the bar as "more correct results **and** no more wrong words than
Live." Tap scored 44/50 against Live's 45/50 — it does not clear "more correct,"
so the rule's plain reading is: revert the default to Live. Two further gaps
make the rule even harder to apply as intended: wrong-word counts were not
tracked in this run (the second half of the rule can't be evaluated at all),
and KNOW / DON'T UNDERSTAND — named in the plan specifically because it's the
project's known confusable pair and mislabeling hotspot — was not tested;
DON'T KNOW was signed in its place, a different pair entirely.

**The override was made knowingly, not by rationalizing the numbers.** The
44-vs-45 result was put in front of the person who owns this decision, framed
plainly as "essentially tied," with a direct choice between keeping Tap or
reverting to Live. They chose to keep Tap. That is a considered decision to
accept Tap despite the rule, not a claim that Tap passed the rule — this
document previously blurred that line by saying the result "gives no evidence
against" Tap, which reads as satisfying the rule rather than overriding it.
That framing has been corrected here.

**Caveat, and what a real re-test would need:** wrong-word vs. no-result wasn't
distinguished in this pass, lighting/hand-rest position weren't recorded, and
the plan's own named confusable pair (KNOW / DON'T UNDERSTAND) was never
actually tried. If tap mode's accuracy is revisited, re-running with all three
of those tracked would let the plan's rule be applied as written, rather than
overridden again for lack of the data it needs.
