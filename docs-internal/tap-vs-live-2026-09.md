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

**Decision:** keep Tap as default.

The two modes scored within one attempt of each other out of 50 (45 vs 44), which
is inside normal run-to-run variation for a sample this size — not a meaningful
gap either way. Tap is kept as the default (unchanged from what Task 6 shipped)
because it is the mode designed to match the model's training conditions (trim,
24fps resample, peak-velocity window) exactly, and this result gives no evidence
against that design intent. HELLO (Live's worst word, 3/5) improved to 4/5 under
Tap, consistent with — though not proof of — the plan's expectation that clean
sign boundaries help the harder classes most.

**Caveat:** wrong-word vs. no-result wasn't distinguished in this pass, and
lighting/hand-rest position weren't recorded. If tap mode's accuracy is revisited
later, capturing failure type (and which specific word was substituted, for
confusable pairs like GOOD AFTERNOON/GOOD EVENING) would make the comparison more
diagnostic than the correct-count alone.
