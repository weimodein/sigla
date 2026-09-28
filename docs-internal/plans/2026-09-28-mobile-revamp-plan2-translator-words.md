# Mobile Revamp — Plan 2: Translator and Word Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the translator (with a recording timer) and every word screen (Word Bank, category word list, word detail) in the new navy design, show Filipino translations on word screens, add "Try it yourself", and have the backend send each word's vocabulary.

**Architecture:** Each screen's layout is rewritten whole in the Plan 1 design system (`sg_*` colours, `Sigla.Text.*` / `Widget.Sigla.*` styles), keeping every view id its Activity still reads. Activity changes are limited to UI code. New decisions that can be tested off-device live in a pure file, `WordVocabulary.kt`, with unit tests. The backend gains one attribute on one query.

**Tech Stack:** Kotlin, Android Views + XML, viewBinding (translator) and findViewById (word screens), Material Components 1.11, Glide 4.16, JUnit 4; Node/Express + Sequelize backend.

**Spec:** `docs-internal/specs/2026-09-28-mobile-ui-revamp-design.md` (mockups in `docs-internal/specs/2026-09-28-mobile-ui-revamp/`: `translator-v2.html`, `tabs-v1.html`, `words-v1.html` option A). This plan covers build-order phases **3 and 4**. History, Settings, onboarding, the dark pass and removal of old resources are Plan 3.

## Global Constraints

- Colours only from `sg_*` tokens (`sg_brand`, `sg_brand_text`, `sg_bg`, `sg_tint`, `sg_bar_bg`, `sg_text`, `sg_text_secondary`, `sg_divider`, `sg_danger`, `sg_success`, `sg_on_brand`, `sg_on_brand_secondary`). The one exception is the video stage/camera background, which stays black-ish (`#0A0E21` / `#000000`) in both modes.
- Poppins Regular and SemiBold only; sizes 22 / 17 / 13 / 11sp, plus 26sp for the word title on word detail only.
- Spacing from {4, 8, 12, 16, 20, 24, 32}dp; screen side padding 20dp; radii 24 / 20 / 16dp; every tappable view ≥ 48dp.
- Red (`sg_danger`) only for recording, SOS and destructive actions.
- The bottom bar appears only on the four tab screens. Translator, category word list and word detail have no bottom bar.
- **Tap-to-sign logic must not change**: `TapSignSession`, `ClipPreparer`, the landmark sink's frame routing, `processCapture` and its `finishProcessing` gate, and `cancelTap()` being called on every mode switch, vocabulary switch, camera flip, `stopVision` and `onPause`. Moving a `cancelTap()` call into a new helper is allowed as long as every one of those paths still reaches it.
- No new features beyond the spec's list. Collections are not shown or created (spec §5, decided 2026-09-28).
- Commit messages end with the co-author trailer your session's attribution instructions specify.

**Clarifications of the spec made in this plan:**
- The translator switches from `Theme.Sigla.Immersive` to the normal `Theme.Sigla`. Its bottom sheet is now light (spec §5 mockup), so the immersive dark window would flash dark before the light UI and put a dark navigation bar under a white sheet. The fullscreen video keeps `Theme.Sigla.Immersive`.
- On the translator, Words/Letters becomes two chips and Tap/Live becomes a two-segment pill, as in the mockup; each segment selects its value directly (today one button toggles).
- Word detail keeps its video controls in a compact panel under the video (spec §5, updated 2026-09-28).
- Dialogs and bottom sheets opened from Word Bank (download-all, confirm, rename/delete) keep their current look until Plan 3.

## Environment

- Kotlin tests, from `sigla-mobile/` in Git Bash: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && ./gradlew testDebugUnitTest`; one class: append `--tests com.example.sigla.WordVocabularyTest`. Build: `./gradlew assembleDebug`.
- Backend tests, from `sigla-backend/`: `npm test`.
- Baseline on `main`: 76 Kotlin unit tests; backend `npm test` passes.
- Device install: `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk`. Never uninstall the app or clear its data (it wipes the user's history and favorites).

## Review Focus

1. **Word bank cached before the backend change** (no `vocabulary` on any word) — the Letters pill must still find the alphabet, and "Try it yourself" on a letter must not crash. Pinned by `fallsBackToSingleCapitalLetterRule` and `gridCategoriesFilterByVocabulary` (Task 2).
2. **"Try it yourself" on a letter when no letters model is loaded** — the translator opens on Words, no crash. Pinned by `lettersRequestIgnoredWithoutLettersModel` (Task 2).
3. **Switching Words/Letters or Tap/Live with the new chips/segments during a tap recording** — the recording must still be cancelled. Checked by the Task 4 reviewer (every path reaches `cancelTap()`) and the Task 8 device check.
4. **Word with no thumbnail anywhere** (no local file, no URL) — the row shows the hand placeholder, no blank square, no crash. Pinned by the Task 8 device check (Glide can't run in JVM unit tests).
5. **Long words and translations** ("SEE YOU TOMORROW", "Kita tayo bukas") in rows, the result card and word detail — one line with an ellipsis in rows and the result card; word detail wraps. Pinned by the Task 8 device check.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `sigla-backend/src/routes/wordRoutes.js` | Modify | Word-bank response includes `vocabulary` |
| `sigla-mobile/.../ApiService.kt` | Modify | `WordBankWord.vocabulary` |
| `sigla-mobile/.../WordVocabulary.kt` | Create | Pure: effective vocabulary, translator start vocabulary, Word Bank grid categories |
| `sigla-mobile/app/src/test/.../WordVocabularyTest.kt` | Create | Tests for the above |
| `res/values/styles_sigla.xml` | Modify | `Widget.Sigla.IconButton`, `Widget.Sigla.Chip`, sheet and thumbnail shapes |
| `res/drawable/ic_star_line.xml`, `ic_star_fill.xml`, `ic_hand_placeholder.xml`, `bg_sg_thumb.xml`, `bg_sg_status_dot.xml`, `bg_sg_pill.xml`, `bg_sg_chip_success.xml` | Create | Icons and shapes |
| `res/layout/activity_main.xml` + `MainActivity.kt` | Rewrite / Modify | Translator |
| `AndroidManifest.xml` | Modify | Translator theme |
| `res/layout/item_word_simple.xml` + `SimpleWordAdapter.kt` | Rewrite | Word row |
| `res/layout/activity_category_word_list.xml` + `CategoryWordListActivity.kt` | Rewrite / Modify | Category word list |
| `res/layout/activity_word_bank.xml` + `WordBankActivity.kt` | Rewrite / Modify | Word Bank |
| `res/layout/item_category_card.xml` + `CategoryGridAdapter.kt` | Rewrite | Category card |
| `CategoryColorUtil.kt` | Delete | Per-category colours retired |
| `res/layout/activity_word_detail.xml` + `WordDetailActivity.kt` | Rewrite / Modify | Word detail |

`...` = `sigla-mobile/app/src/main/kotlin/com/example/sigla`; `res/` = `sigla-mobile/app/src/main/res`. Paths below are relative to the repo root unless they start with `app/` (then relative to `sigla-mobile/`).

---

### Task 1: Backend — send each word's vocabulary

**Files:**
- Modify: `sigla-backend/src/routes/wordRoutes.js` (the `GET /word-bank` handler's `attributes` list)

**Interfaces:**
- Produces: each object in `GET /api/words/word-bank` → `words[]` gains `"vocabulary": "words" | "letters"`. Additive; existing fields and order unchanged.

- [ ] **Step 1: Add the attribute**

In `sigla-backend/src/routes/wordRoutes.js`, in the `Word.findAll({ … attributes: [ … ] })` call inside the `router.get("/word-bank", …)` handler, add `"vocabulary"` after `"filipino_translation"`:
```js
      attributes: [
        "id",
        "label",
        "description",
        "sign_type",
        "thumbnail_url",
        "video_url",
        "filipino_translation",
        // Which model the word belongs to ("words" | "letters"). The app uses it
        // to open the translator on the right vocabulary from a word's page.
        "vocabulary",
      ],
```

- [ ] **Step 2: Verify the column is readable (read-only)**

From `sigla-backend/`, run a read-only query through the app's own models (it reads the live database in `PG_URI`; it writes nothing):
```bash
node -e '
require("dotenv").config();
const { Word } = require("./src/models/index.js");
Word.findAll({ attributes: ["id", "label", "vocabulary"], limit: 5, order: [["label", "ASC"]] })
  .then(r => { console.log(r.map(w => w.toJSON())); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
'
```
Expected: five objects each with a `vocabulary` of `"words"` or `"letters"`. (If `src/models/index.js` exports differently, import `Word` the way `src/routes/wordRoutes.js` does at its top.)

- [ ] **Step 3: Run backend tests**

Run: `npm test` (from `sigla-backend/`). Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add sigla-backend/src/routes/wordRoutes.js
git commit -m "feat(backend): word-bank response includes each word's vocabulary"
```

The Hostinger deploy happens in Task 8; the app works with or without it.

---

### Task 2: Vocabulary and grid logic (pure Kotlin, TDD)

**Files:**
- Modify: `app/src/main/kotlin/com/example/sigla/ApiService.kt` (`WordBankWord`)
- Create: `app/src/main/kotlin/com/example/sigla/WordVocabulary.kt`
- Create: `app/src/test/kotlin/com/example/sigla/WordVocabularyTest.kt`

**Interfaces:**
- Consumes: `PredictionService.Vocabulary` (enum with `WORDS`, `LETTERS`, nested in `PredictionService`).
- Produces:
  - `WordBankWord.vocabulary: String? = null`
  - `const val VOCAB_WORDS = "words"`, `const val VOCAB_LETTERS = "letters"`
  - `internal fun effectiveVocabulary(word: WordBankWord): String`
  - `internal fun translatorStartVocabulary(requested: String?, hasLetters: Boolean): PredictionService.Vocabulary?`
  - `enum class VocabularyFilter { ALL, WORDS, LETTERS }`
  - `data class GridCategory(val name: String, val wordCount: Int)`
  - `internal fun gridCategories(words: List<WordBankWord>, categoryNames: List<String>, filter: VocabularyFilter): List<GridCategory>`

- [ ] **Step 1: Add the field**

In `ApiService.kt`, in `data class WordBankWord`, add after `val filipino_translation: String? = null`:
```kotlin
    ,
    /** "words" | "letters" from the backend; null in word banks cached before it was sent. */
    val vocabulary: String? = null
```
so the class ends:
```kotlin
    val filipino_translation: String? = null,
    /** "words" | "letters" from the backend; null in word banks cached before it was sent. */
    val vocabulary: String? = null
)
```

- [ ] **Step 2: Write the failing tests**

Create `app/src/test/kotlin/com/example/sigla/WordVocabularyTest.kt`:
```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WordVocabularyTest {

    private fun word(id: Int, label: String, category: String = "Greeting", vocabulary: String? = null) =
        WordBankWord(id = id, label = label, category = category, vocabulary = vocabulary)

    // ── effectiveVocabulary ───────────────────────────────────────────────────

    @Test
    fun usesTheBackendValueWhenPresent() {
        assertEquals(VOCAB_LETTERS, effectiveVocabulary(word(1, "NG", vocabulary = "letters")))
        assertEquals(VOCAB_WORDS, effectiveVocabulary(word(2, "A", vocabulary = "words")))
        assertEquals(VOCAB_LETTERS, effectiveVocabulary(word(3, "M", vocabulary = "LETTERS")))
    }

    // Review Focus 1: word banks cached before the backend sent the field.
    @Test
    fun fallsBackToSingleCapitalLetterRule() {
        assertEquals(VOCAB_LETTERS, effectiveVocabulary(word(1, "M")))
        assertEquals(VOCAB_WORDS, effectiveVocabulary(word(2, "MONDAY")))
        assertEquals(VOCAB_WORDS, effectiveVocabulary(word(3, "m")))
        assertEquals(VOCAB_WORDS, effectiveVocabulary(word(4, "NG")))
    }

    @Test
    fun unknownBackendValueFallsBackToTheRule() {
        assertEquals(VOCAB_LETTERS, effectiveVocabulary(word(1, "B", vocabulary = "numbers")))
        assertEquals(VOCAB_WORDS, effectiveVocabulary(word(2, "HELLO", vocabulary = "")))
    }

    // ── translatorStartVocabulary ─────────────────────────────────────────────

    @Test
    fun lettersRequestOpensOnLetters() {
        assertEquals(PredictionService.Vocabulary.LETTERS, translatorStartVocabulary("letters", hasLetters = true))
    }

    // Review Focus 2.
    @Test
    fun lettersRequestIgnoredWithoutLettersModel() {
        assertNull(translatorStartVocabulary("letters", hasLetters = false))
    }

    @Test
    fun wordsNullAndUnknownRequestsChangeNothing() {
        assertNull(translatorStartVocabulary("words", hasLetters = true))
        assertNull(translatorStartVocabulary(null, hasLetters = true))
        assertNull(translatorStartVocabulary("shapes", hasLetters = true))
    }

    // ── gridCategories ────────────────────────────────────────────────────────

    private val bank = listOf(
        word(1, "HELLO", "Greeting"),
        word(2, "GOOD MORNING", "greeting"),
        word(3, "A", "Alphabet"),
        word(4, "B", "Alphabet"),
        word(5, "MOTHER", "Family"),
    )

    @Test
    fun allKeepsEveryCategoryInOrderWithTotals() {
        assertEquals(
            listOf(GridCategory("Family", 1), GridCategory("Greeting", 2),
                   GridCategory("Alphabet", 2), GridCategory("Colors", 0)),
            gridCategories(bank, listOf("Family", "Greeting", "Alphabet", "Colors"), VocabularyFilter.ALL),
        )
    }

    // Review Focus 1 (grid side).
    @Test
    fun gridCategoriesFilterByVocabulary() {
        val names = listOf("Family", "Greeting", "Alphabet", "Colors")
        assertEquals(
            listOf(GridCategory("Family", 1), GridCategory("Greeting", 2)),
            gridCategories(bank, names, VocabularyFilter.WORDS),
        )
        assertEquals(
            listOf(GridCategory("Alphabet", 2)),
            gridCategories(bank, names, VocabularyFilter.LETTERS),
        )
    }

    @Test
    fun mixedCategoryCountsOnlyMatchingWords() {
        val mixed = listOf(word(1, "A", "Mixed"), word(2, "APPLE", "Mixed"))
        assertEquals(listOf(GridCategory("Mixed", 1)), gridCategories(mixed, listOf("Mixed"), VocabularyFilter.LETTERS))
        assertEquals(listOf(GridCategory("Mixed", 1)), gridCategories(mixed, listOf("Mixed"), VocabularyFilter.WORDS))
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.WordVocabularyTest`
Expected: compilation FAILURE — unresolved `effectiveVocabulary`, `VOCAB_LETTERS`, `translatorStartVocabulary`, `GridCategory`, `gridCategories`, `VocabularyFilter`.

- [ ] **Step 4: Implement**

Create `app/src/main/kotlin/com/example/sigla/WordVocabulary.kt`:
```kotlin
package com.example.sigla

// Pure decisions for the word screens and "Try it yourself" (spec §5–6).

const val VOCAB_WORDS = "words"
const val VOCAB_LETTERS = "letters"

private val SINGLE_CAPITAL_LETTER = Regex("^[A-Z]$")

/**
 * Which model a word belongs to. The backend's `vocabulary` wins when it is one
 * of the two known values; otherwise (word banks cached before the field was
 * sent) the rule migration 007 used to backfill it: a single capital A–Z is a
 * letter, everything else is a word.
 */
internal fun effectiveVocabulary(word: WordBankWord): String =
    when (word.vocabulary?.lowercase()) {
        VOCAB_WORDS -> VOCAB_WORDS
        VOCAB_LETTERS -> VOCAB_LETTERS
        else -> if (SINGLE_CAPITAL_LETTER.matches(word.label)) VOCAB_LETTERS else VOCAB_WORDS
    }

/**
 * The vocabulary "Try it yourself" should switch the translator to, or null to
 * leave it as it opens (Words). Letters only when a letters model is loaded.
 */
internal fun translatorStartVocabulary(requested: String?, hasLetters: Boolean): PredictionService.Vocabulary? =
    if (requested == VOCAB_LETTERS && hasLetters) PredictionService.Vocabulary.LETTERS else null

enum class VocabularyFilter { ALL, WORDS, LETTERS }

data class GridCategory(val name: String, val wordCount: Int)

/**
 * Word Bank's category cards for the selected filter pill. ALL keeps every
 * category in the given order, with total counts, including empty ones (as the
 * grid always has). WORDS / LETTERS count only words of that vocabulary and drop
 * categories left with none. Categories match words case-insensitively.
 */
internal fun gridCategories(
    words: List<WordBankWord>,
    categoryNames: List<String>,
    filter: VocabularyFilter,
): List<GridCategory> {
    val wanted = when (filter) {
        VocabularyFilter.ALL -> null
        VocabularyFilter.WORDS -> VOCAB_WORDS
        VocabularyFilter.LETTERS -> VOCAB_LETTERS
    }
    val counts = HashMap<String, Int>()
    for (w in words) {
        if (wanted != null && effectiveVocabulary(w) != wanted) continue
        val key = w.category.lowercase()
        counts[key] = (counts[key] ?: 0) + 1
    }
    val all = categoryNames.map { GridCategory(it, counts[it.lowercase()] ?: 0) }
    return if (wanted == null) all else all.filter { it.wordCount > 0 }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.WordVocabularyTest` → PASS (8 tests). Then `./gradlew testDebugUnitTest` → 84 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/kotlin/com/example/sigla/ApiService.kt app/src/main/kotlin/com/example/sigla/WordVocabulary.kt app/src/test/kotlin/com/example/sigla/WordVocabularyTest.kt
git commit -m "feat(mobile): word vocabulary, translator start vocabulary, grid filter logic"
```

---

### Task 3: Shared components for Plan 2 screens

**Files:**
- Modify: `app/src/main/res/values/styles_sigla.xml`
- Create: `app/src/main/res/drawable/ic_star_line.xml`, `ic_star_fill.xml`, `ic_hand_placeholder.xml`, `bg_sg_thumb.xml`, `bg_sg_status_dot.xml`, `bg_sg_pill.xml`, `bg_sg_chip_success.xml`

**Interfaces:**
- Produces: styles `Widget.Sigla.IconButton` (48dp round tint button with brand icon), `Widget.Sigla.Chip` (48dp-tall touch area, 36dp visible pill), `ShapeAppearance.Sigla.TopSheet`, `ShapeAppearance.Sigla.Thumb`; drawables `ic_star_line`, `ic_star_fill`, `ic_hand_placeholder`, `bg_sg_thumb`, `bg_sg_status_dot`, `bg_sg_pill`, `bg_sg_chip_success`.

- [ ] **Step 1: Styles**

In `app/src/main/res/values/styles_sigla.xml`, add before `</resources>`:
```xml
    <!-- ── Plan 2 components ── -->

    <!-- Round 48dp icon button on a tint background (back, flip camera, download…). -->
    <style name="Widget.Sigla.IconButton" parent="Widget.MaterialComponents.Button.UnelevatedButton">
        <item name="android:layout_width">@dimen/sg_touch_min</item>
        <item name="android:layout_height">@dimen/sg_touch_min</item>
        <item name="android:minWidth">0dp</item>
        <item name="android:minHeight">0dp</item>
        <item name="android:insetTop">0dp</item>
        <item name="android:insetBottom">0dp</item>
        <item name="android:padding">0dp</item>
        <item name="iconGravity">textStart</item>
        <item name="iconPadding">0dp</item>
        <item name="iconSize">22dp</item>
        <item name="iconTint">@color/sg_brand_text</item>
        <item name="backgroundTint">@color/sg_tint</item>
        <item name="cornerRadius">24dp</item>
    </style>

    <!-- Filter/toggle pill. 48dp touch height, 36dp drawn (6dp insets). Colours are
         set in code for on/off; these are the "off" defaults. -->
    <style name="Widget.Sigla.Chip" parent="Widget.MaterialComponents.Button.UnelevatedButton">
        <item name="android:layout_width">wrap_content</item>
        <item name="android:layout_height">@dimen/sg_touch_min</item>
        <item name="android:minWidth">0dp</item>
        <item name="android:minHeight">0dp</item>
        <item name="android:insetTop">6dp</item>
        <item name="android:insetBottom">6dp</item>
        <item name="android:paddingStart">@dimen/sg_space_16</item>
        <item name="android:paddingEnd">@dimen/sg_space_16</item>
        <item name="android:textAllCaps">false</item>
        <item name="android:letterSpacing">0</item>
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_caption</item>
        <item name="android:textColor">@color/sg_brand_text</item>
        <item name="backgroundTint">@color/sg_tint</item>
        <item name="cornerRadius">18dp</item>
    </style>

    <!-- Translator bottom sheet: rounded top corners only. -->
    <style name="ShapeAppearance.Sigla.TopSheet" parent="">
        <item name="cornerFamily">rounded</item>
        <item name="cornerSizeTopLeft">28dp</item>
        <item name="cornerSizeTopRight">28dp</item>
        <item name="cornerSizeBottomLeft">0dp</item>
        <item name="cornerSizeBottomRight">0dp</item>
    </style>

    <!-- Word row thumbnail. -->
    <style name="ShapeAppearance.Sigla.Thumb" parent="">
        <item name="cornerFamily">rounded</item>
        <item name="cornerSize">14dp</item>
    </style>
```

- [ ] **Step 2: Star icons**

Create `app/src/main/res/drawable/ic_star_line.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M12,3.5l2.6,5.3 5.8,0.8 -4.2,4.1 1,5.8L12,16.8 6.8,19.5l1,-5.8 -4.2,-4.1 5.8,-0.8z"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
</vector>
```
Create `app/src/main/res/drawable/ic_star_fill.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M12,3.5l2.6,5.3 5.8,0.8 -4.2,4.1 1,5.8L12,16.8 6.8,19.5l1,-5.8 -4.2,-4.1 5.8,-0.8z"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineJoin="round"
        android:fillColor="#FFFFFF" />
</vector>
```

- [ ] **Step 3: Thumbnail placeholder**

Create `app/src/main/res/drawable/ic_hand_placeholder.xml` — the Plan 1 hand, drawn in brand text colour and centred with padding, so it can be a Glide placeholder without tinting the loaded photo:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="52dp"
    android:height="52dp"
    android:viewportWidth="48"
    android:viewportHeight="48">
    <group android:translateX="12" android:translateY="12">
        <path
            android:pathData="M9,11V5.2a1.2,1.2 0,0 1,2.4 0V10.5M11.4,10.5V4a1.2,1.2 0,0 1,2.4 0V10.5M13.8,10.8V5.6a1.2,1.2 0,0 1,2.4 0V13.5a5,5 0,0 1,-5 5H11a4.6,4.6 0,0 1,-3.6 -1.8L4.9,13.1a1.3,1.3 0,0 1,2 -1.6L9,13.8V11"
            android:strokeColor="@color/sg_brand_text"
            android:strokeWidth="1.7"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:fillColor="#00000000" />
    </group>
</vector>
```

- [ ] **Step 4: Shapes**

Create `app/src/main/res/drawable/bg_sg_thumb.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/sg_bg" />
    <corners android:radius="14dp" />
</shape>
```
Create `app/src/main/res/drawable/bg_sg_status_dot.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Tinted in code by status (loading / ready / error). -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#FFFFFF" />
    <size android:width="8dp" android:height="8dp" />
</shape>
```
Create `app/src/main/res/drawable/bg_sg_pill.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- White pill behind the translator's Tap/Live segments. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/sg_bg" />
    <corners android:radius="24dp" />
</shape>
```
Create `app/src/main/res/drawable/bg_sg_chip_success.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- "Saved offline" chip: success colour at ~12% on its own pill. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#1F2E7D32" />
    <corners android:radius="14dp" />
</shape>
```

- [ ] **Step 5: Build**

Run: `./gradlew assembleDebug` → BUILD SUCCESSFUL (a bad attribute or path fails resource linking here). Tests unchanged at 84.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/res/values/styles_sigla.xml app/src/main/res/drawable/ic_star_line.xml app/src/main/res/drawable/ic_star_fill.xml app/src/main/res/drawable/ic_hand_placeholder.xml app/src/main/res/drawable/bg_sg_thumb.xml app/src/main/res/drawable/bg_sg_status_dot.xml app/src/main/res/drawable/bg_sg_pill.xml app/src/main/res/drawable/bg_sg_chip_success.xml
git commit -m "feat(mobile): icon button, chip, sheet and thumbnail components"
```

---

### Task 4: Translator restyle and recording timer

**Files:**
- Rewrite: `app/src/main/res/layout/activity_main.xml`
- Modify: `app/src/main/kotlin/com/example/sigla/MainActivity.kt`
- Modify: `app/src/main/AndroidManifest.xml` (MainActivity's theme)

**Interfaces:**
- Consumes: Task 2 `translatorStartVocabulary`, `VOCAB_*`; Task 3 styles/drawables; Plan 1 tokens and `ic_chat_line`, `ic_back`, `ic_camera_flip`.
- Produces: `MainActivity.EXTRA_START_VOCABULARY` (String extra, `"words"`/`"letters"`), read once when the models become ready. View ids that change type: `btnToggleMode` and `btnToggleVocabulary` become `LinearLayout` containers; new ids `segModeTap`, `segModeLive`, `chipWords`, `chipLetters`, `statusDot`, `tvSheetHint`, `liveReadout`, `cameraContainer`, `bottomSheet`. Removed ids (unused by code): `cameraCard`, `tvReadyOverlay`, `topBarCard`, `tvNoHandsDetected`, `bottomPanelCard`, `bottomPanel`, `tvCooldownStatus`, `floatingEmergencyContainer`, `tvEmergencyHint`.

Kept ids and types, all still read by `MainActivity`: `cameraPreview` (PreviewView), `overlayView` (OverlayView), `cardResult` (MaterialCardView), `tvResult`, `tvFilipinoResult`, `tapControls` (LinearLayout), `tvTapPrompt`, `tapRecordRing` (CircularProgressIndicator), `btnTapRecord` (MaterialButton), `btnBack`, `btnFlipCamera` (MaterialButton), `tvHandsWarning`, `tvStatus`, `btnToggleFilipino` (MaterialButton), `btnEmergency` (MaterialButton), `tvDetectionLabel`, `progressBuffer` (ProgressBar), `liveStatsRow` (LinearLayout), `tvFrames`, `tvBufferPercent`, `tvVelocity`, `tvStreak`.

- [ ] **Step 1: Rewrite the layout**

Replace the whole content of `app/src/main/res/layout/activity_main.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Translator (spec §5, mockup translator-v2.html). Camera fills the screen above
     a compact bottom sheet; the sheet overlaps the camera by 28dp so its rounded
     top corners sit on the picture. Controls float over the camera. -->
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sg_bg">

    <!-- Camera: from the top down to 28dp inside the sheet. -->
    <FrameLayout
        android:id="@+id/cameraContainer"
        android:layout_width="0dp"
        android:layout_height="0dp"
        android:background="#000000"
        app:layout_constraintTop_toTopOf="parent"
        app:layout_constraintBottom_toBottomOf="@id/sheetOverlap"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent">

        <androidx.camera.view.PreviewView
            android:id="@+id/cameraPreview"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />

        <com.example.sigla.OverlayView
            android:id="@+id/overlayView"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />
    </FrameLayout>

    <!-- Top controls over the camera -->
    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnBack"
        style="@style/Widget.Sigla.IconButton"
        android:layout_marginStart="@dimen/sg_space_16"
        android:layout_marginTop="@dimen/sg_space_16"
        android:contentDescription="Back"
        app:backgroundTint="@color/sg_bg"
        app:icon="@drawable/ic_back"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

    <LinearLayout
        android:id="@+id/btnToggleMode"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_sg_pill"
        android:orientation="horizontal"
        android:paddingStart="@dimen/sg_space_4"
        android:paddingEnd="@dimen/sg_space_4"
        app:layout_constraintBottom_toBottomOf="@id/btnBack"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="@id/btnBack">

        <com.google.android.material.button.MaterialButton
            android:id="@+id/segModeTap"
            style="@style/Widget.Sigla.Chip"
            android:text="Tap" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/segModeLive"
            style="@style/Widget.Sigla.Chip"
            android:text="Live" />
    </LinearLayout>

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnFlipCamera"
        style="@style/Widget.Sigla.IconButton"
        android:layout_marginTop="@dimen/sg_space_16"
        android:layout_marginEnd="@dimen/sg_space_16"
        android:contentDescription="Flip camera"
        app:backgroundTint="@color/sg_bg"
        app:icon="@drawable/ic_camera_flip"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

    <!-- Result card, floating under the top controls -->
    <com.google.android.material.card.MaterialCardView
        android:id="@+id/cardResult"
        style="@style/Widget.Sigla.Card.Outlined"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="@dimen/sg_screen_padding"
        android:layout_marginTop="@dimen/sg_space_16"
        android:layout_marginEnd="@dimen/sg_screen_padding"
        android:visibility="invisible"
        app:cardCornerRadius="@dimen/sg_radius_md"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toBottomOf="@id/btnBack"
        tools:visibility="visible">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal"
            android:padding="@dimen/sg_space_12">

            <FrameLayout
                android:layout_width="@dimen/sg_badge_size"
                android:layout_height="@dimen/sg_badge_size"
                android:background="@drawable/bg_sg_circle_tint">
                <ImageView
                    android:layout_width="20dp"
                    android:layout_height="20dp"
                    android:layout_gravity="center"
                    android:importantForAccessibility="no"
                    android:src="@drawable/ic_chat_line"
                    android:tint="@color/sg_brand_text" />
            </FrameLayout>

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:layout_marginStart="@dimen/sg_space_12"
                android:orientation="vertical">
                <TextView
                    android:id="@+id/tvResult"
                    style="@style/Sigla.Text.CardTitle"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:ellipsize="end"
                    android:maxLines="1"
                    tools:text="GOOD MORNING" />
                <TextView
                    android:id="@+id/tvFilipinoResult"
                    style="@style/Sigla.Text.Caption"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:visibility="gone"
                    tools:text="Magandang umaga"
                    tools:visibility="visible" />
            </LinearLayout>
        </LinearLayout>
    </com.google.android.material.card.MaterialCardView>

    <TextView
        android:id="@+id/tvHandsWarning"
        style="@style/Sigla.Text.Caption"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="@dimen/sg_space_8"
        android:background="@drawable/bg_sg_pill"
        android:backgroundTint="@color/sg_danger"
        android:paddingStart="@dimen/sg_space_12"
        android:paddingTop="@dimen/sg_space_4"
        android:paddingEnd="@dimen/sg_space_12"
        android:paddingBottom="@dimen/sg_space_4"
        android:text="More than 2 hands detected"
        android:textColor="@color/sg_on_brand"
        android:visibility="gone"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toBottomOf="@id/cardResult" />

    <!-- Tap mode: prompt + record button, just above the sheet -->
    <LinearLayout
        android:id="@+id/tapControls"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginBottom="@dimen/sg_space_16"
        android:gravity="center_horizontal"
        android:orientation="vertical"
        android:visibility="gone"
        app:layout_constraintBottom_toTopOf="@id/bottomSheet"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        tools:visibility="visible">

        <TextView
            android:id="@+id/tvTapPrompt"
            style="@style/Sigla.Text.Body"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginBottom="@dimen/sg_space_12"
            android:background="@drawable/bg_sg_pill"
            android:backgroundTint="#A6000000"
            android:paddingStart="@dimen/sg_space_16"
            android:paddingTop="@dimen/sg_space_4"
            android:paddingEnd="@dimen/sg_space_16"
            android:paddingBottom="@dimen/sg_space_4"
            android:textColor="@color/sg_on_brand"
            android:visibility="gone"
            tools:text="Recording… 1.8s"
            tools:visibility="visible" />

        <FrameLayout
            android:layout_width="100dp"
            android:layout_height="100dp">

            <com.google.android.material.progressindicator.CircularProgressIndicator
                android:id="@+id/tapRecordRing"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:max="100"
                android:visibility="invisible"
                app:indicatorColor="@color/sg_danger"
                app:indicatorSize="100dp"
                app:trackThickness="5dp" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnTapRecord"
                android:layout_width="84dp"
                android:layout_height="84dp"
                android:layout_gravity="center"
                android:insetTop="0dp"
                android:insetBottom="0dp"
                android:padding="0dp"
                android:fontFamily="@font/poppins_semibold"
                android:text="Tap to sign"
                android:textAllCaps="false"
                android:textColor="@color/sg_on_brand"
                android:textSize="@dimen/sg_text_caption"
                app:backgroundTint="@color/sg_brand"
                app:cornerRadius="42dp"
                app:strokeColor="@color/sg_bg"
                app:strokeWidth="4dp" />
        </FrameLayout>
    </LinearLayout>

    <!-- Live mode readout, in the same place as the record button. Its children
         are shown/hidden individually by renderTapState(); with all three gone the
         container collapses. -->
    <LinearLayout
        android:id="@+id/liveReadout"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="@dimen/sg_screen_padding"
        android:layout_marginEnd="@dimen/sg_screen_padding"
        android:layout_marginBottom="@dimen/sg_space_16"
        android:orientation="vertical"
        app:layout_constraintBottom_toTopOf="@id/bottomSheet"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent">

        <TextView
            android:id="@+id/tvDetectionLabel"
            style="@style/Sigla.Text.Caption"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginBottom="@dimen/sg_space_4"
            android:text="Detecting"
            android:textColor="@color/sg_on_brand" />

        <ProgressBar
            android:id="@+id/progressBuffer"
            style="?android:attr/progressBarStyleHorizontal"
            android:layout_width="match_parent"
            android:layout_height="6dp"
            android:max="100"
            android:progress="0"
            android:progressBackgroundTint="@color/sg_tint"
            android:progressTint="@color/sg_brand" />

        <LinearLayout
            android:id="@+id/liveStatsRow"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="@dimen/sg_space_4"
            android:gravity="center_vertical"
            android:orientation="horizontal">
            <TextView
                android:id="@+id/tvFrames"
                style="@style/Sigla.Text.Caption"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:textColor="@color/sg_on_brand"
                tools:text="24" />
            <TextView
                android:id="@+id/tvBufferPercent"
                style="@style/Sigla.Text.Caption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginEnd="@dimen/sg_space_12"
                android:textColor="@color/sg_on_brand"
                android:text="0%" />
            <TextView
                android:id="@+id/tvVelocity"
                style="@style/Sigla.Text.Caption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="—"
                android:textColor="@color/sg_on_brand" />
            <TextView
                android:id="@+id/tvStreak"
                style="@style/Sigla.Text.Caption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginStart="@dimen/sg_space_8"
                android:textColor="@color/sg_on_brand"
                android:visibility="gone" />
        </LinearLayout>
    </LinearLayout>

    <!-- Marks 28dp inside the sheet, where the camera ends. -->
    <Space
        android:id="@+id/sheetOverlap"
        android:layout_width="0dp"
        android:layout_height="0dp"
        android:layout_marginTop="28dp"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="@id/bottomSheet" />

    <!-- Bottom sheet -->
    <com.google.android.material.card.MaterialCardView
        android:id="@+id/bottomSheet"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        app:cardBackgroundColor="@color/sg_bg"
        app:cardElevation="12dp"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:shapeAppearanceOverlay="@style/ShapeAppearance.Sigla.TopSheet"
        app:strokeWidth="0dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingStart="@dimen/sg_screen_padding"
            android:paddingTop="@dimen/sg_space_12"
            android:paddingEnd="@dimen/sg_screen_padding"
            android:paddingBottom="@dimen/sg_space_16">

            <View
                android:layout_width="40dp"
                android:layout_height="4dp"
                android:layout_gravity="center_horizontal"
                android:layout_marginBottom="@dimen/sg_space_8"
                android:background="@drawable/bg_sg_pill"
                android:backgroundTint="@color/sg_divider" />

            <!-- Status + SOS on one row -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">
                <View
                    android:id="@+id/statusDot"
                    android:layout_width="8dp"
                    android:layout_height="8dp"
                    android:background="@drawable/bg_sg_status_dot"
                    android:backgroundTint="@color/sg_text_secondary" />
                <TextView
                    android:id="@+id/tvStatus"
                    style="@style/Sigla.Text.BodyStrong"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:layout_marginStart="@dimen/sg_space_8"
                    android:ellipsize="end"
                    android:maxLines="1"
                    android:text="Starting…" />
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnEmergency"
                    style="@style/Widget.Sigla.Chip"
                    android:contentDescription="Hold for two seconds to play an emergency alert"
                    android:text="Hold for SOS"
                    android:textColor="@color/sg_on_brand"
                    app:backgroundTint="@color/sg_danger" />
            </LinearLayout>

            <!-- Words / Letters (shown when a letters model is loaded) + Filipino -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="horizontal">
                <LinearLayout
                    android:id="@+id/btnToggleVocabulary"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:orientation="horizontal"
                    android:visibility="gone"
                    tools:visibility="visible">
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipWords"
                        style="@style/Widget.Sigla.Chip"
                        android:layout_marginEnd="@dimen/sg_space_8"
                        android:text="Words" />
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipLetters"
                        style="@style/Widget.Sigla.Chip"
                        android:layout_marginEnd="@dimen/sg_space_8"
                        android:text="Letters" />
                </LinearLayout>
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnToggleFilipino"
                    style="@style/Widget.Sigla.Chip"
                    android:text="Filipino" />
            </LinearLayout>

            <TextView
                android:id="@+id/tvSheetHint"
                style="@style/Sigla.Text.Caption"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="Tap, sign one word, then lower your hands." />
        </LinearLayout>
    </com.google.android.material.card.MaterialCardView>

</androidx.constraintlayout.widget.ConstraintLayout>
```

- [ ] **Step 2: Manifest — normal theme**

In `app/src/main/AndroidManifest.xml`, on the `<activity android:name=".MainActivity" …/>` element, delete the attribute `android:theme="@style/Theme.Sigla.Immersive"` (it then uses the app's `Theme.Sigla`). Leave `FullscreenVideoActivity`'s theme as it is.

- [ ] **Step 3: MainActivity — status helper**

In `MainActivity.kt`, add near the other private helpers (e.g. just above `// ── Predictor callbacks ──`):
```kotlin
    private enum class StatusKind { LOADING, READY, ERROR }

    /** Sheet status line: text plus a coloured dot (spec §5). Main thread only. */
    private fun setStatus(text: String, kind: StatusKind) {
        binding.tvStatus.text = text
        val colour = when (kind) {
            StatusKind.LOADING -> R.color.sg_text_secondary
            StatusKind.READY -> R.color.sg_success
            StatusKind.ERROR -> R.color.sg_danger
        }
        binding.statusDot.backgroundTintList =
            ColorStateList.valueOf(ContextCompat.getColor(this, colour))
    }
```
Then replace every status write (search for `binding.tvStatus.`) with a `setStatus` call, removing the paired `setTextColor(… holo_…)` line:

| Current text | Replace with |
|---|---|
| `"Starting camera..."` (and its orange `setTextColor` line) | `setStatus("Starting camera…", StatusKind.LOADING)` |
| `"Loading hand tracking..."` | `setStatus("Loading hand tracking…", StatusKind.LOADING)` |
| `"Checking for model updates..."` | `setStatus("Checking for model updates…", StatusKind.LOADING)` |
| `"⚠ Failed to download model"` + red | `setStatus("Couldn't download the model", StatusKind.ERROR)` |
| `"Updating word bank..."` | `setStatus("Updating word bank…", StatusKind.LOADING)` |
| `"Fetching words from database..."` | `setStatus("Loading words…", StatusKind.LOADING)` |
| `"Models loaded"` + green | `setStatus("Ready", StatusKind.READY)` |
| `"Failed to load words from database"` + red | `setStatus("Couldn't load the words", StatusKind.ERROR)` |
| `"⚠ Error: ${e.message}"` + red | `setStatus("Error: ${e.message}", StatusKind.ERROR)` |

After this, `grep -n "tvStatus.setTextColor\|holo_" MainActivity.kt` must only match `motionIndicatorColor`'s `holo_orange_light` (the live-mode indicator, left as is).

- [ ] **Step 4: MainActivity — toggle styling**

Replace the whole `applyToggleStyle` function with:
```kotlin
    /** Filled brand when on, tint when off (chips in the sheet). */
    private fun applyToggleStyle(button: MaterialButton, on: Boolean) {
        val bg = if (on) R.color.sg_brand else R.color.sg_tint
        val fg = if (on) R.color.sg_on_brand else R.color.sg_brand_text
        button.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this, bg))
        button.setTextColor(ContextCompat.getColor(this, fg))
    }

    /** Filled brand when on, transparent when off (segments inside the white pill). */
    private fun applySegmentStyle(button: MaterialButton, on: Boolean) {
        button.backgroundTintList = ColorStateList.valueOf(
            if (on) ContextCompat.getColor(this, R.color.sg_brand) else Color.TRANSPARENT
        )
        button.setTextColor(ContextCompat.getColor(this, if (on) R.color.sg_on_brand else R.color.sg_text_secondary))
    }
```
Replace `updateModeToggleLabel()` with:
```kotlin
    private fun updateModeToggleLabel() {
        applySegmentStyle(binding.segModeTap, tapMode)
        applySegmentStyle(binding.segModeLive, !tapMode)
    }
```
Replace the body of `updateVocabularyToggleLabel()` (keep its KDoc) with:
```kotlin
    private fun updateVocabularyToggleLabel() {
        val predictor = this.predictor
        if (predictor == null || !predictor.hasLetters()) {
            binding.btnToggleVocabulary.visibility = View.GONE
            return
        }
        binding.btnToggleVocabulary.visibility = View.VISIBLE
        val letters = predictor.currentVocabulary() == PredictionService.Vocabulary.LETTERS
        applyToggleStyle(binding.chipWords, !letters)
        applyToggleStyle(binding.chipLetters, letters)
    }
```

- [ ] **Step 5: MainActivity — explicit mode and vocabulary selection**

Add these two functions next to `cancelTap()`:
```kotlin
    /**
     * Switches Tap/Live. No-op when already in [tap]. Cancels any tap recording and
     * clears the realtime buffer, so neither mode inherits the other's frames.
     */
    private fun selectMode(tap: Boolean) {
        if (tapMode == tap) return
        tapMode = tap
        appSettings.translationMode = if (tapMode) AppSettings.MODE_TAP else AppSettings.MODE_LIVE
        predictor?.reset()
        predictor?.onNoHands?.invoke()
        updateModeToggleLabel()
        cancelTap()
        binding.cardResult.visibility = View.INVISIBLE
    }

    /**
     * Switches Words/Letters. No-op when already on [target] or no predictor yet.
     * The two vocabularies are separate models because a letter and the day sign
     * built from it differ only in motion — M and MONDAY separate at 1.06 — so one
     * class list carrying both would confuse them. The user says which they sign.
     */
    private fun selectVocabulary(target: PredictionService.Vocabulary) {
        val predictor = this.predictor ?: return
        if (predictor.currentVocabulary() == target) return
        predictor.setVocabulary(target)
        updateVocabularyToggleLabel()
        // The partially-collected gesture belongs to the old vocabulary and
        // setVocabulary already dropped it. Clear the on-screen progress the same
        // way the end of a gesture does.
        predictor.onNoHands?.invoke()
        cancelTap()
    }
```
In `setupButtons()`:
- Replace the whole `binding.btnToggleVocabulary.setOnClickListener { … }` block (and its comment block above it) with:
```kotlin
        // Words / letters vocabulary chips — each selects its own value.
        binding.chipWords.setOnClickListener { selectVocabulary(PredictionService.Vocabulary.WORDS) }
        binding.chipLetters.setOnClickListener { selectVocabulary(PredictionService.Vocabulary.LETTERS) }
```
- Replace the whole `binding.btnToggleMode.setOnClickListener { … }` block (and its comment) with:
```kotlin
        // Tap / Live segments — each selects its own mode.
        binding.segModeTap.setOnClickListener { selectMode(tap = true) }
        binding.segModeLive.setOnClickListener { selectMode(tap = false) }
```
The bodies moved into `selectMode` / `selectVocabulary` unchanged apart from the early return, so every mode and vocabulary switch still calls `cancelTap()`.

- [ ] **Step 6: MainActivity — tap controls colours, timer, hint**

In `renderTapState()`:
- Replace `val accent = ContextCompat.getColor(this, R.color.sig_accent)` with `val accent = ContextCompat.getColor(this, R.color.sg_brand)` and `val red = Color.parseColor("#E53935")` with `val red = ContextCompat.getColor(this, R.color.sg_danger)`.
- After the line `binding.tapControls.visibility = if (tapMode) View.VISIBLE else View.GONE`, add:
```kotlin
        binding.tvSheetHint.visibility = if (tapMode) View.VISIBLE else View.GONE
```
- In the `RECORDING` branch, change `binding.tvTapPrompt.text = "Recording…"` to `binding.tvTapPrompt.text = recordingPromptText(0L)`.

Replace the `tapRingTicker` property with:
```kotlin
    private val tapRingTicker = object : Runnable {
        override fun run() {
            if (tapSession.state != TapSignSession.State.RECORDING) return
            val elapsed = tapSession.recordingElapsedMs()
            val pct = (elapsed * 100 / TAP_MAX_RECORDING_MS).toInt()
            binding.tapRecordRing.setProgressCompat(pct.coerceIn(0, 100), false)
            binding.tvTapPrompt.text = recordingPromptText(elapsed)
            binding.tapRecordRing.postDelayed(this, 100)
        }
    }

    /** "Recording… 1.8s" — the elapsed time the tap-to-sign spec asked for. */
    private fun recordingPromptText(elapsedMs: Long): String =
        String.format(java.util.Locale.US, "Recording… %.1fs", elapsedMs / 1000f)
```

- [ ] **Step 7: MainActivity — "Try it yourself" start vocabulary**

Add a companion object to `MainActivity` (or add to the existing one if there is one):
```kotlin
    companion object {
        /** "words" | "letters": vocabulary to open on, from a word's "Try it yourself". */
        const val EXTRA_START_VOCABULARY = "extra_start_vocabulary"
    }
```
Add a field next to `lastLabel`:
```kotlin
    // Applied once, when the models first report ready (the predictor is built
    // asynchronously, so it can't be applied in onCreate).
    private var pendingStartVocabulary: String? = null
```
In `onCreate`, right after `tapMode = appSettings.translationMode == AppSettings.MODE_TAP`, add:
```kotlin
        pendingStartVocabulary = intent.getStringExtra(EXTRA_START_VOCABULARY)
```
In `startVision()`, in the `if (service.isReady) { … }` branch, directly after the existing `updateVocabularyToggleLabel()` call, add:
```kotlin
                        pendingStartVocabulary?.let { requested ->
                            pendingStartVocabulary = null
                            translatorStartVocabulary(requested, service.hasLetters())
                                ?.let { selectVocabulary(it) }
                        }
```

- [ ] **Step 8: Tidy imports and build**

Remove imports the compiler reports as unused only if they became unused through this task. Run: `./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL, 84 tests. Then:
```bash
git diff main -- app/src/main/kotlin/com/example/sigla/MainActivity.kt | grep -nE "^[-+].*(cancelTap|finishProcessing|processFrame|tapSession\.(tap|onFrame|cancel))"
```
and confirm in the report that every `cancelTap()` call site that existed before (flip camera, vocabulary switch, mode switch, `stopVision`, `onPause`) still exists or now lives inside `selectMode` / `selectVocabulary`, and that no `processFrame`, `onFrame`, `finishProcessing` or `tapSession.tap` line was removed.

- [ ] **Step 9: Commit**

```bash
git add app/src/main/res/layout/activity_main.xml app/src/main/kotlin/com/example/sigla/MainActivity.kt app/src/main/AndroidManifest.xml
git commit -m "feat(mobile): translator restyle, segmented mode and vocabulary, recording timer"
```

---

### Task 5: Word rows and the category word list

**Files:**
- Rewrite: `app/src/main/res/layout/item_word_simple.xml`, `app/src/main/kotlin/com/example/sigla/SimpleWordAdapter.kt`
- Rewrite: `app/src/main/res/layout/activity_category_word_list.xml`
- Modify: `app/src/main/kotlin/com/example/sigla/CategoryWordListActivity.kt`, `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt` (adapter construction only)

**Interfaces:**
- Consumes: Task 3 `ShapeAppearance.Sigla.Thumb`, `bg_sg_thumb`, `ic_hand_placeholder`, `ic_star_line`, `ic_star_fill`, `Widget.Sigla.IconButton`; `ModelUpdateManager.getLocalThumb(context, wordId): File?`; `ApiClient.resolveUrl(url: String?): String?`.
- Produces: `SimpleWordAdapter(words: MutableList<WordBankWord>, isFavorite: (Int) -> Boolean, onWordClick: (WordBankWord) -> Unit)`; row ids `ivWordThumb`, `tvSimpleWord`, `tvWordFilipino`, `ivWordStar`.

- [ ] **Step 1: Row layout**

Replace the whole content of `app/src/main/res/layout/item_word_simple.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Word row (spec §5 "Word rows", mockup words-v1 option A). -->
<com.google.android.material.card.MaterialCardView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    style="@style/Widget.Sigla.Card.Tint"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="@dimen/sg_space_12"
    android:clickable="true"
    android:focusable="true">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:minHeight="76dp"
        android:orientation="horizontal"
        android:padding="@dimen/sg_space_12">

        <com.google.android.material.imageview.ShapeableImageView
            android:id="@+id/ivWordThumb"
            android:layout_width="52dp"
            android:layout_height="52dp"
            android:background="@drawable/bg_sg_thumb"
            android:importantForAccessibility="no"
            android:scaleType="centerCrop"
            app:shapeAppearanceOverlay="@style/ShapeAppearance.Sigla.Thumb" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginStart="@dimen/sg_space_12"
            android:orientation="vertical">
            <TextView
                android:id="@+id/tvSimpleWord"
                style="@style/Sigla.Text.BodyStrong"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:ellipsize="end"
                android:maxLines="1"
                tools:text="Good morning" />
            <TextView
                android:id="@+id/tvWordFilipino"
                style="@style/Sigla.Text.Caption"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:ellipsize="end"
                android:maxLines="1"
                tools:text="Magandang umaga" />
        </LinearLayout>

        <ImageView
            android:id="@+id/ivWordStar"
            android:layout_width="20dp"
            android:layout_height="20dp"
            android:layout_marginStart="@dimen/sg_space_12"
            android:src="@drawable/ic_star_line"
            android:tint="@color/sg_text_secondary"
            tools:ignore="ContentDescription" />
    </LinearLayout>
</com.google.android.material.card.MaterialCardView>
```

- [ ] **Step 2: Adapter**

Replace the whole content of `app/src/main/kotlin/com/example/sigla/SimpleWordAdapter.kt`:
```kotlin
package com.example.sigla

import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy

/**
 * Word row (thumbnail, word, Filipino translation, favorite star) used by the
 * category word list and by Word Bank search results. Tapping a row opens the
 * word's detail screen. The star only shows favorite state; favoriting stays on
 * the detail screen (spec §5).
 */
class SimpleWordAdapter(
    private val words: MutableList<WordBankWord>,
    private val isFavorite: (Int) -> Boolean,
    private val onWordClick: (WordBankWord) -> Unit,
) : RecyclerView.Adapter<SimpleWordAdapter.WordViewHolder>() {

    class WordViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val thumb: ImageView = view.findViewById(R.id.ivWordThumb)
        val tvWord: TextView = view.findViewById(R.id.tvSimpleWord)
        val tvFilipino: TextView = view.findViewById(R.id.tvWordFilipino)
        val star: ImageView = view.findViewById(R.id.ivWordStar)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WordViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_word_simple, parent, false)
        return WordViewHolder(view)
    }

    override fun onBindViewHolder(holder: WordViewHolder, position: Int) {
        val word = words[position]
        val context = holder.itemView.context

        holder.tvWord.text = word.label.toTitleCase()
        val filipino = word.filipino_translation?.trim().orEmpty()
        holder.tvFilipino.text = filipino
        holder.tvFilipino.visibility = if (filipino.isEmpty()) View.GONE else View.VISIBLE

        // Saved copy first (works offline), then the URL; the hand placeholder when
        // neither exists or loading fails.
        val source: Any? = ModelUpdateManager.getLocalThumb(context, word.id)
            ?: ApiClient.resolveUrl(word.thumbnail_url)
        Glide.with(holder.thumb)
            .load(source)
            .diskCacheStrategy(DiskCacheStrategy.ALL)
            .placeholder(R.drawable.ic_hand_placeholder)
            .error(R.drawable.ic_hand_placeholder)
            .fallback(R.drawable.ic_hand_placeholder)
            .into(holder.thumb)

        val fav = isFavorite(word.id)
        holder.star.setImageResource(if (fav) R.drawable.ic_star_fill else R.drawable.ic_star_line)
        holder.star.imageTintList = ColorStateList.valueOf(
            ContextCompat.getColor(context, if (fav) R.color.sg_brand_text else R.color.sg_text_secondary)
        )
        holder.star.contentDescription = if (fav) "In favorites" else null

        holder.itemView.contentDescription =
            if (filipino.isEmpty()) word.label else "${word.label}, $filipino"
        holder.itemView.setOnClickListener { onWordClick(word) }
    }

    override fun getItemCount(): Int = words.size

    /**
     * Diffs against the current contents rather than calling notifyDataSetChanged().
     * Word Bank calls this on every debounced keystroke.
     */
    fun setWords(newWords: List<WordBankWord>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = words.size
            override fun getNewListSize() = newWords.size
            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos].id == newWords[newPos].id
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos] == newWords[newPos]
        })
        words.clear()
        words.addAll(newWords)
        diff.dispatchUpdatesTo(this)
    }

    /** Re-draws the stars after favorites may have changed on the detail screen. */
    fun refreshFavorites() {
        if (words.isNotEmpty()) notifyItemRangeChanged(0, words.size)
    }
}
```
Note: `word.label.toTitleCase()` changes how labels read in rows ("GOOD MORNING" → "Good Morning") to match the mockup; the detail screen and results keep their own casing.

- [ ] **Step 3: Category word list layout**

Replace the whole content of `app/src/main/res/layout/activity_category_word_list.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Category word list (spec §5, mockup words-v1 option A). No bottom bar: it is
     reached from Word Bank or Home and returns with Back. -->
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sg_bg"
    android:orientation="vertical"
    android:paddingStart="@dimen/sg_screen_padding"
    android:paddingTop="@dimen/sg_space_16"
    android:paddingEnd="@dimen/sg_screen_padding">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal">

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnBack"
            style="@style/Widget.Sigla.IconButton"
            android:contentDescription="Back"
            app:icon="@drawable/ic_back" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginStart="@dimen/sg_space_12"
            android:orientation="vertical">
            <TextView
                android:id="@+id/tvCategoryTitle"
                style="@style/Sigla.Text.Title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:ellipsize="end"
                android:maxLines="1"
                tools:text="Greetings" />
            <TextView
                android:id="@+id/tvCategorySubtitle"
                style="@style/Sigla.Text.Caption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                tools:text="14 words" />
        </LinearLayout>
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="@dimen/sg_search_height"
        android:layout_marginTop="@dimen/sg_space_16"
        android:background="@drawable/bg_sg_search"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="@dimen/sg_space_16"
        android:paddingEnd="@dimen/sg_space_16">
        <ImageView
            android:layout_width="20dp"
            android:layout_height="20dp"
            android:importantForAccessibility="no"
            android:src="@drawable/ic_search_line"
            android:tint="@color/sg_text_secondary" />
        <com.google.android.material.textfield.TextInputEditText
            android:id="@+id/etCategorySearch"
            style="@style/Sigla.Text.Body"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:layout_marginStart="@dimen/sg_space_12"
            android:background="@null"
            android:imeOptions="actionSearch"
            android:inputType="text"
            android:maxLines="1"
            android:textColorHint="@color/sg_text_secondary"
            tools:hint="Search in Greetings…" />
    </LinearLayout>

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:layout_marginTop="@dimen/sg_space_16">

        <androidx.recyclerview.widget.RecyclerView
            android:id="@+id/rvCategoryWords"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:clipToPadding="false"
            android:paddingBottom="@dimen/sg_space_24"
            android:visibility="gone" />

        <ProgressBar
            android:id="@+id/progressLoading"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="center"
            android:indeterminateTint="@color/sg_brand"
            android:visibility="gone" />

        <LinearLayout
            android:id="@+id/emptyState"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:gravity="center"
            android:orientation="vertical"
            android:visibility="gone">
            <TextView
                style="@style/Sigla.Text.CardTitle"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="No words found" />
            <TextView
                style="@style/Sigla.Text.Secondary"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_4"
                android:text="Try a different search term." />
        </LinearLayout>
    </FrameLayout>
</LinearLayout>
```

- [ ] **Step 4: CategoryWordListActivity**

In `app/src/main/kotlin/com/example/sigla/CategoryWordListActivity.kt`:
1. Delete the two status-bar lines in `onCreate` (`window.statusBarColor = …#0A0E21…` and `WindowCompat.getInsetsController(…).isAppearanceLightStatusBars = false`) and the now-unused `import androidx.core.view.WindowCompat`. The theme now colours the status bar.
2. Change the adapter construction to:
```kotlin
        adapter = SimpleWordAdapter(
            mutableListOf(),
            isFavorite = { id -> favoritesManager.isFavorite(id) },
        ) { word -> openWordDetail(word) }
```
3. Replace `onResume()` with:
```kotlin
    override fun onResume() {
        super.onResume()
        // Favorites may have changed on the word detail screen.
        if (isFavorites) onWordsUpdated() else if (::adapter.isInitialized) adapter.refreshFavorites()
    }
```
4. If the subtitle is set with a capitalised "Words" (e.g. `"${n} Words"`), change it to lowercase `"$n word" + if (n == 1) "" else "s"` to match the mockup ("14 words").
5. Check the `emptyState` field type still matches the layout (`LinearLayout`) — it does in the layout above.

- [ ] **Step 5: WordBankActivity adapter construction**

In `WordBankActivity.kt`, in `setupRecyclerView()`, change the adapter construction to:
```kotlin
        adapter = SimpleWordAdapter(
            mutableListOf(),
            isFavorite = { id -> favoritesManager.isFavorite(id) },
        ) { word -> openWordDetail(word) }
```
`favoritesManager` is assigned in `onCreate` before `setupRecyclerView()` runs (confirm the order; move the assignment above `bindViews()` if not). The rest of Word Bank changes in Task 6.

- [ ] **Step 6: Build**

Run: `./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL, 84 tests.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/res/layout/item_word_simple.xml app/src/main/kotlin/com/example/sigla/SimpleWordAdapter.kt app/src/main/res/layout/activity_category_word_list.xml app/src/main/kotlin/com/example/sigla/CategoryWordListActivity.kt app/src/main/kotlin/com/example/sigla/WordBankActivity.kt
git commit -m "feat(mobile): word rows with thumbnail, Filipino and favorite star; category list restyle"
```

---

### Task 6: Word Bank — header, filter pills, category cards

**Files:**
- Rewrite: `app/src/main/res/layout/activity_word_bank.xml`, `app/src/main/res/layout/item_category_card.xml`, `app/src/main/kotlin/com/example/sigla/CategoryGridAdapter.kt`
- Modify: `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt`
- Delete: `app/src/main/kotlin/com/example/sigla/CategoryColorUtil.kt`

**Interfaces:**
- Consumes: Task 2 `gridCategories`, `VocabularyFilter`; Task 3 `Widget.Sigla.IconButton`, `Widget.Sigla.Chip`, `ic_star_fill`; Plan 1 `view_bottom_nav`, `ic_book_line`, `ic_tag_line`, `ic_download_all`.
- Produces: Word Bank ids — kept: `etSearch`, `rvWords`, `emptyState`, `tvEntryCount`, `progressLoading`, `categoryGridContainer`, `rvCategoryGrid`, `btnDownloadAllVideos`; new: `tvWordBankSubtitle`, `pillAll`, `pillWords`, `pillLetters`; removed: `btnCategoryPill`, `tvTopBarTitle`, `tvTopBarSubtitle`, `filterRow`, `tvBrowseByCategory`, `topBarOuterWrapper`. Category card ids: `cardCategory`, `ivCategoryIcon`, `tvCategoryName`, `tvCategoryCount` (`cardIconChip` removed).

- [ ] **Step 1: Word Bank layout**

Replace the whole content of `app/src/main/res/layout/activity_word_bank.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Word Bank (spec §5, mockup tabs-v1). Bottom bar navigation (view_bottom_nav.xml).
     Grid mode shows the filter pills and category cards; typing a search switches to
     list mode (word rows). -->
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sg_bg">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:paddingStart="@dimen/sg_screen_padding"
        android:paddingTop="@dimen/sg_space_24"
        android:paddingEnd="@dimen/sg_screen_padding">

        <!-- Header -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">
            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical">
                <TextView
                    style="@style/Sigla.Text.Title"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Word Bank" />
                <TextView
                    android:id="@+id/tvWordBankSubtitle"
                    style="@style/Sigla.Text.Caption"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Filipino Sign Language words" />
            </LinearLayout>
            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnDownloadAllVideos"
                style="@style/Widget.Sigla.IconButton"
                android:contentDescription="Download all demo videos for offline use"
                app:icon="@drawable/ic_download_all" />
        </LinearLayout>

        <!-- Search -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="@dimen/sg_search_height"
            android:layout_marginTop="@dimen/sg_space_16"
            android:background="@drawable/bg_sg_search"
            android:gravity="center_vertical"
            android:orientation="horizontal"
            android:paddingStart="@dimen/sg_space_16"
            android:paddingEnd="@dimen/sg_space_16">
            <ImageView
                android:layout_width="20dp"
                android:layout_height="20dp"
                android:importantForAccessibility="no"
                android:src="@drawable/ic_search_line"
                android:tint="@color/sg_text_secondary" />
            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/etSearch"
                style="@style/Sigla.Text.Body"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:layout_marginStart="@dimen/sg_space_12"
                android:background="@null"
                android:hint="Search words…"
                android:imeOptions="actionSearch"
                android:inputType="text"
                android:maxLines="1"
                android:textColorHint="@color/sg_text_secondary" />
        </LinearLayout>

        <!-- Grid mode: pills + categories -->
        <LinearLayout
            android:id="@+id/categoryGridContainer"
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_weight="1"
            android:orientation="vertical">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_8"
                android:orientation="horizontal">
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/pillAll"
                    style="@style/Widget.Sigla.Chip"
                    android:layout_marginEnd="@dimen/sg_space_8"
                    android:text="All" />
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/pillWords"
                    style="@style/Widget.Sigla.Chip"
                    android:layout_marginEnd="@dimen/sg_space_8"
                    android:text="Words" />
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/pillLetters"
                    style="@style/Widget.Sigla.Chip"
                    android:text="Letters" />
            </LinearLayout>

            <TextView
                style="@style/Sigla.Text.Section"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_8"
                android:layout_marginBottom="@dimen/sg_space_8"
                android:text="Categories" />

            <!-- -6dp offsets the 6dp margin on each card so the grid lines up with
                 the screen padding. -->
            <androidx.recyclerview.widget.RecyclerView
                android:id="@+id/rvCategoryGrid"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:layout_marginStart="-6dp"
                android:layout_marginEnd="-6dp"
                android:clipToPadding="false"
                android:paddingBottom="@dimen/sg_bottom_bar_clearance" />
        </LinearLayout>

        <!-- List mode: search results -->
        <TextView
            android:id="@+id/tvEntryCount"
            style="@style/Sigla.Text.Caption"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="@dimen/sg_space_16"
            android:layout_marginBottom="@dimen/sg_space_8"
            android:visibility="gone"
            tools:text="Showing 24 words" />

        <FrameLayout
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_weight="1">
            <androidx.recyclerview.widget.RecyclerView
                android:id="@+id/rvWords"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:clipToPadding="false"
                android:paddingBottom="@dimen/sg_bottom_bar_clearance"
                android:visibility="gone" />
            <ProgressBar
                android:id="@+id/progressLoading"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_gravity="center"
                android:indeterminateTint="@color/sg_brand"
                android:visibility="gone" />
            <LinearLayout
                android:id="@+id/emptyState"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:gravity="center"
                android:orientation="vertical"
                android:visibility="gone">
                <TextView
                    style="@style/Sigla.Text.CardTitle"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="No words found" />
                <TextView
                    style="@style/Sigla.Text.Secondary"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="@dimen/sg_space_4"
                    android:gravity="center"
                    android:text="Try a different search, or connect to the internet to download the word bank." />
            </LinearLayout>
        </FrameLayout>
    </LinearLayout>

    <include layout="@layout/view_bottom_nav" />
</androidx.coordinatorlayout.widget.CoordinatorLayout>
```
Note: grid and list sections each have `layout_weight="1"`; the Activity keeps exactly one of them visible (`categoryGridContainer` in grid mode, the list `FrameLayout`'s children in list mode). Because the list `FrameLayout` itself has no id and is always visible, in grid mode it takes half the height while empty. To avoid that, give the list `FrameLayout` `android:id="@+id/listContainer"` and toggle it in Step 3.

- [ ] **Step 2: Category card layout and adapter**

Replace the whole content of `app/src/main/res/layout/item_category_card.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Category card (spec §4: uniform pale cards, Favorites is the navy highlight). -->
<com.google.android.material.card.MaterialCardView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:id="@+id/cardCategory"
    style="@style/Widget.Sigla.Card.Tint"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_margin="6dp"
    android:clickable="true"
    android:focusable="true">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:minHeight="104dp"
        android:orientation="vertical"
        android:padding="@dimen/sg_space_12">
        <ImageView
            android:id="@+id/ivCategoryIcon"
            android:layout_width="24dp"
            android:layout_height="24dp"
            android:importantForAccessibility="no"
            android:src="@drawable/ic_tag_line" />
        <TextView
            android:id="@+id/tvCategoryName"
            style="@style/Sigla.Text.BodyStrong"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="@dimen/sg_space_8"
            android:ellipsize="end"
            android:hyphenationFrequency="none"
            tools:text="Greetings" />
        <TextView
            android:id="@+id/tvCategoryCount"
            style="@style/Sigla.Text.Caption"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            tools:text="14 words" />
    </LinearLayout>
</com.google.android.material.card.MaterialCardView>
```
Replace the whole content of `app/src/main/kotlin/com/example/sigla/CategoryGridAdapter.kt`:
```kotlin
package com.example.sigla

import android.content.Context
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView

/**
 * Word Bank category cards (spec §4–5): uniform pale cards, with Favorites as the
 * navy highlight. Replaces the old per-category colours (CategoryColorUtil).
 */
class CategoryGridAdapter(
    private val items: MutableList<CategoryGridItem>,
    private val onClick: (CategoryGridItem) -> Unit,
) : RecyclerView.Adapter<CategoryGridAdapter.CardViewHolder>() {

    class CardViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val card: MaterialCardView = view.findViewById(R.id.cardCategory)
        val icon: ImageView = view.findViewById(R.id.ivCategoryIcon)
        val name: TextView = view.findViewById(R.id.tvCategoryName)
        val count: TextView = view.findViewById(R.id.tvCategoryCount)
    }

    /** Colours resolved once per adapter, not per bind. */
    private class Palette(context: Context) {
        private fun c(id: Int) = ContextCompat.getColor(context, id)
        val brand = c(R.color.sg_brand)
        val tint = c(R.color.sg_tint)
        val onBrand = c(R.color.sg_on_brand)
        val onBrandSecondary = c(R.color.sg_on_brand_secondary)
        val text = c(R.color.sg_text)
        val textSecondary = c(R.color.sg_text_secondary)
        val brandText = c(R.color.sg_brand_text)
    }

    private var palette: Palette? = null
    private fun palette(context: Context) = palette ?: Palette(context).also { palette = it }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder =
        CardViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_category_card, parent, false))

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val item = items[position]
        val p = palette(holder.itemView.context)

        // Favorites/All Words are literal labels; server categories are title-cased
        // so a long all-caps name doesn't fill the card edge to edge.
        val displayText = if (item.isFavorites || item.isAllWords) item.displayName else item.displayName.toTitleCase()
        // A single word must never wrap (Android would hyphenate it mid-word).
        holder.name.maxLines = if (displayText.contains(' ')) 2 else 1
        holder.name.text = displayText
        holder.count.text = "${item.wordCount} word${if (item.wordCount != 1) "s" else ""}"

        val navy = item.isFavorites
        holder.card.setCardBackgroundColor(if (navy) p.brand else p.tint)
        holder.name.setTextColor(if (navy) p.onBrand else p.text)
        holder.count.setTextColor(if (navy) p.onBrandSecondary else p.textSecondary)
        holder.icon.setImageResource(
            when {
                item.isFavorites -> R.drawable.ic_star_fill
                item.isAllWords -> R.drawable.ic_book_line
                else -> R.drawable.ic_tag_line
            }
        )
        holder.icon.imageTintList = ColorStateList.valueOf(if (navy) p.onBrand else p.brandText)

        holder.card.contentDescription = "$displayText, ${holder.count.text}"
        holder.card.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    fun setItems(newItems: List<CategoryGridItem>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = items.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean {
                val a = items[oldPos]
                val b = newItems[newPos]
                return a.isFavorites == b.isFavorites &&
                    a.isAllWords == b.isAllWords &&
                    a.displayName.equals(b.displayName, ignoreCase = true)
            }
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean = items[oldPos] == newItems[newPos]
        })
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
    }
}
```
Then delete the colour helper: `git rm app/src/main/kotlin/com/example/sigla/CategoryColorUtil.kt`, and confirm `grep -rn "CategoryColorUtil" app/src/main` returns nothing.

- [ ] **Step 3: WordBankActivity**

In `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt`:
1. **Status bar:** delete the two lines in `onCreate` that set `window.statusBarColor` to `#0A0E21` and `isAppearanceLightStatusBars = false` (and their comment); remove `import androidx.core.view.WindowCompat` if now unused.
2. **Remove the dropdown:** delete the field `btnCategoryPill`, its `findViewById` in `bindViews()`, the call `setupCategoryDropdown()` in `onCreate`, and the functions `setupCategoryDropdown()`, `getCategoryDisplayList()` and `refreshCategoryDropdown()`. Delete the three calls to `refreshCategoryDropdown()` (in `loadCustomCategories()`, the rename dialog and the delete dialog). Delete `gridCategoryFilter`. Delete `FSL_CATEGORIES` from the companion object if `grep -rn FSL_CATEGORIES app/src` shows no other use. Remove `import android.widget.ArrayAdapter` if now unused.
3. **Pills:** add fields:
```kotlin
    private lateinit var tvWordBankSubtitle: TextView
    private lateinit var pillAll: MaterialButton
    private lateinit var pillWords: MaterialButton
    private lateinit var pillLetters: MaterialButton
    private lateinit var listContainer: View
    private var gridFilter = VocabularyFilter.ALL
```
In `bindViews()` add:
```kotlin
        tvWordBankSubtitle = findViewById(R.id.tvWordBankSubtitle)
        pillAll = findViewById(R.id.pillAll)
        pillWords = findViewById(R.id.pillWords)
        pillLetters = findViewById(R.id.pillLetters)
        listContainer = findViewById(R.id.listContainer)
```
In `onCreate`, where `setupCategoryDropdown()` was, call `setupFilterPills()`, and add:
```kotlin
    private fun setupFilterPills() {
        pillAll.setOnClickListener { selectGridFilter(VocabularyFilter.ALL) }
        pillWords.setOnClickListener { selectGridFilter(VocabularyFilter.WORDS) }
        pillLetters.setOnClickListener { selectGridFilter(VocabularyFilter.LETTERS) }
        renderFilterPills()
    }

    private fun selectGridFilter(filter: VocabularyFilter) {
        gridFilter = filter
        renderFilterPills()
        refreshCategoryGrid()
    }

    private fun renderFilterPills() {
        fun style(pill: MaterialButton, on: Boolean) {
            val bg = if (on) R.color.sg_brand else R.color.sg_tint
            val fg = if (on) R.color.sg_on_brand else R.color.sg_brand_text
            pill.backgroundTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(this, bg))
            pill.setTextColor(ContextCompat.getColor(this, fg))
        }
        style(pillAll, gridFilter == VocabularyFilter.ALL)
        style(pillWords, gridFilter == VocabularyFilter.WORDS)
        style(pillLetters, gridFilter == VocabularyFilter.LETTERS)
    }
```
(add `import androidx.core.content.ContextCompat` if missing).
4. **Grid contents:** in `refreshCategoryGrid()`, replace everything from the line `val countsByCategory = HashMap<String, Int>(categoryNames.size * 2)` down to (and including) `gridAdapter.setItems(items)` with:
```kotlin
        tvWordBankSubtitle.text =
            "${allWords.size} Filipino Sign Language word${if (allWords.size != 1) "s" else ""}"

        val items = mutableListOf<CategoryGridItem>()
        if (gridFilter == VocabularyFilter.ALL) {
            val favoritesCount = allWords.count { favoritesManager.isFavorite(it.id) }
            items.add(CategoryGridItem(displayName = "Favorites", wordCount = favoritesCount, isFavorites = true))
            items.add(CategoryGridItem(displayName = "All Words", wordCount = allWords.size, isAllWords = true))
        }
        gridCategories(allWords, categoryNames, gridFilter).forEach { cat ->
            items.add(CategoryGridItem(displayName = cat.name, wordCount = cat.wordCount))
        }
        gridAdapter.setItems(items)
```
Keep the lines above it (the empty-words early return, the grid-mode empty state line, and the `categoryNames` selection).
5. **Mode visibility:** in `showListMode()` add `listContainer.visibility = View.VISIBLE`; in `showGridMode()` add `listContainer.visibility = View.GONE`. Make sure `emptyState` and `progressLoading` (now inside `listContainer`) still show during initial loading in grid mode: in `showGridMode()`, if `isLoading && allWords.isEmpty()`, set `listContainer.visibility = View.VISIBLE` so the spinner is visible; otherwise GONE. In `refreshCategoryGrid()`'s empty-words branch, where `emptyState` is made visible in grid mode, also set `listContainer.visibility = View.VISIBLE`.
6. **Stars after returning:** in `onResume()`, in the list-mode branch, also call `adapter.refreshFavorites()` after `applyFilters()`.

- [ ] **Step 4: Build and test**

Run: `./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL, 84 tests. Then `grep -rn "btnCategoryPill\|gridCategoryFilter\|CategoryColorUtil\|refreshCategoryDropdown" app/src/main` → no output.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/res/layout/activity_word_bank.xml app/src/main/res/layout/item_category_card.xml app/src/main/kotlin/com/example/sigla/CategoryGridAdapter.kt app/src/main/kotlin/com/example/sigla/WordBankActivity.kt
git commit -m "feat(mobile): Word Bank restyle with All/Words/Letters filter pills"
```
(The `git rm` in Step 2 already staged the deletion of `CategoryColorUtil.kt`.)

---

### Task 7: Word detail — layout, Filipino, "Try it yourself", action bar

**Files:**
- Rewrite: `app/src/main/res/layout/activity_word_detail.xml`
- Modify: `app/src/main/kotlin/com/example/sigla/WordDetailActivity.kt`

**Interfaces:**
- Consumes: Task 2 `effectiveVocabulary`; Task 4 `MainActivity.EXTRA_START_VOCABULARY`; Task 3 `Widget.Sigla.IconButton`, `Widget.Sigla.Chip` shapes, `bg_sg_chip_success`, `ic_star_line`, `ic_star_fill`; Plan 1 `ic_hand_line`, `bg_sg_circle_tint`, `Widget.Sigla.Button`, `Widget.Sigla.Card.Outlined`.
- Kept ids and types (all read by `WordDetailActivity`): `btnBack`, `tvDetailCategoryTitle`, `tvDetailWord`, `btnSpeak` (MaterialButton), `tvCategoryChip`, `tvOfflineBadge`, `contentColumn` (LinearLayout), `cardMedia` (MaterialCardView, **direct child of `contentColumn`** — `fitStageTo` casts its params to `LinearLayout.LayoutParams`), `ivThumbnail`, `videoDemo` (VideoView), `noMediaPlaceholder`, `tvPlaceholderIcon`, `tvPlaceholderText`, `btnRetry`, `progressVideo`, `playOverlay`, `tvMediaCaption`, `controlsPanel`, `btnPlayPause`, `seekVideo` (SeekBar), `tvTime`, `btnReplay`, `speedGroup` (MaterialButtonToggleGroup, single selection, required, default `btnSpeed100`), `btnSpeed50`, `btnSpeed75`, `btnSpeed100`, `btnFullscreen`, `btnDownload` (MaterialButton), `btnAddToFavorites` (MaterialButton). New: `tvDetailFilipino`, `cardTryIt`.

- [ ] **Step 1: Layout**

Replace the whole content of `app/src/main/res/layout/activity_word_detail.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Word detail (spec §5, mockup words-v1). Video first, controls under it, then the
     word, chips and "Try it yourself"; Download and Favorites pinned at the bottom. -->
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sg_bg"
    android:orientation="vertical">

    <!-- Header -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="@dimen/sg_screen_padding"
        android:paddingTop="@dimen/sg_space_16"
        android:paddingEnd="@dimen/sg_screen_padding">
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnBack"
            style="@style/Widget.Sigla.IconButton"
            android:contentDescription="Back"
            app:icon="@drawable/ic_back" />
        <TextView
            android:id="@+id/tvDetailCategoryTitle"
            style="@style/Sigla.Text.BodyStrong"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginStart="@dimen/sg_space_12"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="@color/sg_text_secondary"
            tools:text="Greetings" />
    </LinearLayout>

    <androidx.core.widget.NestedScrollView
        android:id="@+id/scrollContent"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1">

        <LinearLayout
            android:id="@+id/contentColumn"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingStart="@dimen/sg_screen_padding"
            android:paddingTop="@dimen/sg_space_16"
            android:paddingEnd="@dimen/sg_screen_padding"
            android:paddingBottom="@dimen/sg_space_24">

            <!-- Video stage. Its size is set in code (fitStageTo) to the clip's shape. -->
            <com.google.android.material.card.MaterialCardView
                android:id="@+id/cardMedia"
                android:layout_width="match_parent"
                android:layout_height="200dp"
                android:layout_gravity="center_horizontal"
                app:cardBackgroundColor="#0A0E21"
                app:cardCornerRadius="@dimen/sg_radius_lg"
                app:cardElevation="0dp"
                app:strokeWidth="0dp">

                <FrameLayout
                    android:layout_width="match_parent"
                    android:layout_height="match_parent">

                    <ImageView
                        android:id="@+id/ivThumbnail"
                        android:layout_width="match_parent"
                        android:layout_height="match_parent"
                        android:contentDescription="Gesture demonstration image"
                        android:scaleType="fitCenter"
                        android:visibility="gone" />

                    <VideoView
                        android:id="@+id/videoDemo"
                        android:layout_width="match_parent"
                        android:layout_height="match_parent"
                        android:layout_gravity="center"
                        android:contentDescription="Sign demonstration video"
                        android:visibility="gone" />

                    <LinearLayout
                        android:id="@+id/noMediaPlaceholder"
                        android:layout_width="match_parent"
                        android:layout_height="match_parent"
                        android:gravity="center"
                        android:orientation="vertical"
                        android:visibility="gone">
                        <TextView
                            android:id="@+id/tvPlaceholderIcon"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:textSize="@dimen/sg_text_title"
                            tools:text="🤟" />
                        <TextView
                            android:id="@+id/tvPlaceholderText"
                            style="@style/Sigla.Text.Body"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="@dimen/sg_space_8"
                            android:textColor="@color/sg_on_brand_secondary"
                            tools:text="No demo available yet" />
                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnRetry"
                            style="@style/Widget.Sigla.Chip"
                            android:layout_marginTop="@dimen/sg_space_8"
                            android:text="Retry"
                            android:visibility="gone" />
                    </LinearLayout>

                    <FrameLayout
                        android:id="@+id/playOverlay"
                        android:layout_width="match_parent"
                        android:layout_height="match_parent"
                        android:clickable="true"
                        android:contentDescription="Play demo"
                        android:focusable="true"
                        android:visibility="gone">
                        <FrameLayout
                            android:layout_width="60dp"
                            android:layout_height="60dp"
                            android:layout_gravity="center"
                            android:background="@drawable/bg_sg_circle_tint">
                            <ImageView
                                android:layout_width="26dp"
                                android:layout_height="26dp"
                                android:layout_gravity="center"
                                android:importantForAccessibility="no"
                                android:src="@drawable/ic_play"
                                android:tint="@color/sg_brand_text" />
                        </FrameLayout>
                    </FrameLayout>

                    <ProgressBar
                        android:id="@+id/progressVideo"
                        android:layout_width="40dp"
                        android:layout_height="40dp"
                        android:layout_gravity="center"
                        android:indeterminateTint="@color/sg_on_brand"
                        android:visibility="gone" />
                </FrameLayout>
            </com.google.android.material.card.MaterialCardView>

            <TextView
                android:id="@+id/tvMediaCaption"
                style="@style/Sigla.Text.Caption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_8"
                tools:text="Demo Video · 0:05" />

            <!-- Player controls, under the video so they never cover the hands -->
            <LinearLayout
                android:id="@+id/controlsPanel"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_8"
                android:orientation="vertical"
                android:visibility="gone"
                tools:visibility="visible">

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnPlayPause"
                        style="@style/Widget.Sigla.IconButton"
                        android:contentDescription="Play"
                        app:backgroundTint="@color/sg_brand"
                        app:icon="@drawable/ic_play"
                        app:iconTint="@color/sg_on_brand" />
                    <SeekBar
                        android:id="@+id/seekVideo"
                        android:layout_width="0dp"
                        android:layout_height="@dimen/sg_touch_min"
                        android:layout_weight="1"
                        android:contentDescription="Video position"
                        android:progressBackgroundTint="@color/sg_tint"
                        android:progressTint="@color/sg_brand"
                        android:thumbTint="@color/sg_brand" />
                    <TextView
                        android:id="@+id/tvTime"
                        style="@style/Sigla.Text.Caption"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:text="0:00 / 0:00" />
                </LinearLayout>

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnReplay"
                        style="@style/Widget.Sigla.IconButton"
                        android:contentDescription="Replay"
                        app:icon="@drawable/ic_replay" />
                    <View
                        android:layout_width="0dp"
                        android:layout_height="1dp"
                        android:layout_weight="1" />
                    <com.google.android.material.button.MaterialButtonToggleGroup
                        android:id="@+id/speedGroup"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        app:checkedButton="@id/btnSpeed100"
                        app:selectionRequired="true"
                        app:singleSelection="true">
                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnSpeed50"
                            style="@style/Widget.MaterialComponents.Button.OutlinedButton"
                            android:layout_width="wrap_content"
                            android:layout_height="@dimen/sg_touch_min"
                            android:minWidth="0dp"
                            android:text="0.5×"
                            android:textAllCaps="false"
                            android:textColor="@color/sg_brand_text"
                            android:textSize="@dimen/sg_text_caption"
                            app:strokeColor="@color/sg_divider" />
                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnSpeed75"
                            style="@style/Widget.MaterialComponents.Button.OutlinedButton"
                            android:layout_width="wrap_content"
                            android:layout_height="@dimen/sg_touch_min"
                            android:minWidth="0dp"
                            android:text="0.75×"
                            android:textAllCaps="false"
                            android:textColor="@color/sg_brand_text"
                            android:textSize="@dimen/sg_text_caption"
                            app:strokeColor="@color/sg_divider" />
                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnSpeed100"
                            style="@style/Widget.MaterialComponents.Button.OutlinedButton"
                            android:layout_width="wrap_content"
                            android:layout_height="@dimen/sg_touch_min"
                            android:minWidth="0dp"
                            android:text="1×"
                            android:textAllCaps="false"
                            android:textColor="@color/sg_brand_text"
                            android:textSize="@dimen/sg_text_caption"
                            app:strokeColor="@color/sg_divider" />
                    </com.google.android.material.button.MaterialButtonToggleGroup>
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnFullscreen"
                        style="@style/Widget.Sigla.IconButton"
                        android:layout_marginStart="@dimen/sg_space_8"
                        android:contentDescription="Full screen"
                        app:icon="@drawable/ic_fullscreen" />
                </LinearLayout>
            </LinearLayout>

            <!-- Word + Filipino + speak -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_16"
                android:gravity="center_vertical"
                android:orientation="horizontal">
                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">
                    <TextView
                        android:id="@+id/tvDetailWord"
                        style="@style/Sigla.Text.Display"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        tools:text="Good morning" />
                    <TextView
                        android:id="@+id/tvDetailFilipino"
                        style="@style/Sigla.Text.Secondary"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="@dimen/sg_space_4"
                        android:visibility="gone"
                        tools:text="Magandang umaga"
                        tools:visibility="visible" />
                </LinearLayout>
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnSpeak"
                    style="@style/Widget.Sigla.IconButton"
                    android:layout_marginStart="@dimen/sg_space_12"
                    android:contentDescription="Say the word again"
                    app:backgroundTint="@color/sg_brand"
                    app:icon="@drawable/ic_volume_up"
                    app:iconTint="@color/sg_on_brand" />
            </LinearLayout>

            <!-- Chips -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_12"
                android:orientation="horizontal">
                <TextView
                    android:id="@+id/tvCategoryChip"
                    style="@style/Sigla.Text.Caption"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:background="@drawable/bg_sg_search"
                    android:paddingStart="@dimen/sg_space_12"
                    android:paddingTop="@dimen/sg_space_4"
                    android:paddingEnd="@dimen/sg_space_12"
                    android:paddingBottom="@dimen/sg_space_4"
                    android:textColor="@color/sg_brand_text"
                    tools:text="Greetings" />
                <TextView
                    android:id="@+id/tvOfflineBadge"
                    style="@style/Sigla.Text.Caption"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="@dimen/sg_space_8"
                    android:background="@drawable/bg_sg_chip_success"
                    android:paddingStart="@dimen/sg_space_12"
                    android:paddingTop="@dimen/sg_space_4"
                    android:paddingEnd="@dimen/sg_space_12"
                    android:paddingBottom="@dimen/sg_space_4"
                    android:text="✓ Saved offline"
                    android:textColor="@color/sg_success"
                    android:visibility="gone"
                    tools:visibility="visible" />
            </LinearLayout>

            <!-- Try it yourself -->
            <com.google.android.material.card.MaterialCardView
                android:id="@+id/cardTryIt"
                style="@style/Widget.Sigla.Card.Outlined"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_16"
                android:clickable="true"
                android:contentDescription="Try it yourself. Open the translator and sign this word."
                android:focusable="true"
                app:cardCornerRadius="@dimen/sg_radius_md">
                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:gravity="center_vertical"
                    android:orientation="horizontal"
                    android:padding="@dimen/sg_space_12">
                    <FrameLayout
                        android:layout_width="@dimen/sg_badge_size"
                        android:layout_height="@dimen/sg_badge_size"
                        android:background="@drawable/bg_sg_circle_tint">
                        <ImageView
                            android:layout_width="22dp"
                            android:layout_height="22dp"
                            android:layout_gravity="center"
                            android:importantForAccessibility="no"
                            android:src="@drawable/ic_hand_line"
                            android:tint="@color/sg_brand_text" />
                    </FrameLayout>
                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:layout_marginStart="@dimen/sg_space_12"
                        android:importantForAccessibility="noHideDescendants"
                        android:orientation="vertical">
                        <TextView
                            style="@style/Sigla.Text.BodyStrong"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="Try it yourself" />
                        <TextView
                            style="@style/Sigla.Text.Caption"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="Open the translator and sign this word." />
                    </LinearLayout>
                </LinearLayout>
            </com.google.android.material.card.MaterialCardView>
        </LinearLayout>
    </androidx.core.widget.NestedScrollView>

    <!-- Pinned actions, in the thumb zone -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="@color/sg_bg"
        android:elevation="8dp"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="@dimen/sg_screen_padding"
        android:paddingTop="@dimen/sg_space_12"
        android:paddingEnd="@dimen/sg_screen_padding"
        android:paddingBottom="@dimen/sg_space_16">
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnDownload"
            style="@style/Widget.Sigla.IconButton"
            android:layout_marginEnd="@dimen/sg_space_12"
            android:contentDescription="Download for offline"
            android:visibility="gone"
            app:cornerRadius="@dimen/sg_radius_sm"
            app:icon="@drawable/ic_download"
            tools:visibility="visible" />
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnAddToFavorites"
            style="@style/Widget.Sigla.Button"
            android:layout_width="0dp"
            android:layout_height="@dimen/sg_touch_min"
            android:layout_weight="1"
            android:text="Add to Favorites"
            app:icon="@drawable/ic_star_line"
            app:iconGravity="textStart"
            app:iconTint="@color/sg_on_brand" />
    </LinearLayout>
</LinearLayout>
```

- [ ] **Step 2: WordDetailActivity**

In `app/src/main/kotlin/com/example/sigla/WordDetailActivity.kt`:
1. **Status bar:** delete the two lines in `onCreate` that set `window.statusBarColor` to `#0A0E21` and `isAppearanceLightStatusBars = false`; remove `import androidx.core.view.WindowCompat` if now unused.
2. **New views:** add fields `private lateinit var tvDetailFilipino: TextView` and `private lateinit var cardTryIt: View`, and in `bindViews()`:
```kotlin
        tvDetailFilipino = findViewById(R.id.tvDetailFilipino)
        cardTryIt = findViewById(R.id.cardTryIt)
```
3. **Filipino and Try it:** at the end of `bindWord(w)`, before `speakWord(w.label)`, add:
```kotlin
        val filipino = w.filipino_translation?.trim().orEmpty()
        tvDetailFilipino.text = filipino
        tvDetailFilipino.visibility = if (filipino.isEmpty()) View.GONE else View.VISIBLE

        // Opens the translator on the word's own vocabulary (letters for a letter),
        // falling back to Words when the letters model isn't loaded (see MainActivity).
        cardTryIt.setOnClickListener {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_START_VOCABULARY, effectiveVocabulary(w))
            )
        }
```
(add `import android.content.Intent` if missing).
4. **Favorites button:** replace the body of `refreshFavoriteButton(isFavorite: Boolean)` with:
```kotlin
        btnAddToFavorites.text = if (isFavorite) "Added to Favorites" else "Add to Favorites"
        btnAddToFavorites.setIconResource(if (isFavorite) R.drawable.ic_star_fill else R.drawable.ic_star_line)
```
5. **Download button is icon-only now:** in `refreshOfflineState(w)`, replace `btnDownload.text = "Download for offline"` with `btnDownload.contentDescription = "Download for offline"`. In `downloadForOffline(w)`, replace `btnDownload.text = "Downloading…"` with `btnDownload.contentDescription = "Downloading"`. Leave the enable/disable and visibility logic as it is.
6. `btnPlayPause`'s icon is already switched by `showPlayingUi` (`ic_pause`/`ic_play`); nothing to change there.

- [ ] **Step 3: Build and test**

Run: `./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL, 84 tests. Then `grep -n "btnDownload.text\|0A0E21" app/src/main/kotlin/com/example/sigla/WordDetailActivity.kt` → no output.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/res/layout/activity_word_detail.xml app/src/main/kotlin/com/example/sigla/WordDetailActivity.kt
git commit -m "feat(mobile): word detail restyle with Filipino, Try it yourself and pinned actions"
```

---

### Task 8: On-device check and backend deploy

**Files:** none (verification). Results go in the task report.

- [ ] **Step 1: Install** the debug APK (see Environment).

- [ ] **Step 2: Check, in light mode, then with dark mode on**

1. **Translator:** opens from Home with a white bottom sheet, round back and flip buttons, a Tap/Live pill. The status dot turns green at "Ready". The SOS pill is on the status row and still plays the alert after a 2-second hold.
2. **Tap mode:** tap → "Ready — start signing"; sign → "Recording… 1.2s" counting up, red ring; result card shows the word and Filipino.
3. **Switching during a recording** (Review Focus 3): start a recording, then tap Live (or Letters) → the recording stops and no result appears.
4. **Live mode:** the record button is replaced by the live readout; Live still recognises words.
5. **Word Bank:** header with word count, search, All/Words/Letters pills. Words hides Alphabet; Letters shows only Alphabet. Favorites is the navy card; other cards are pale. The download-all button still works.
6. **Search results and category lists:** rows show a thumbnail (or the hand placeholder for a word with none, Review Focus 4), the Filipino line, and a filled star on favourites.
7. **Word detail:** video first with controls under it; speed buttons work; the Filipino line is shown; "Try it yourself" on a letter opens the translator on Letters (if a letters model is loaded), on a word opens it on Words. Favorites and Download work; icons update.
8. **Long text** (Review Focus 5): "See You Tomorrow" / "Kita tayo bukas" fit on one line with an ellipsis in rows and the result card; the word detail title wraps.
9. **Back navigation:** word detail → Back → list → Back → Word Bank; the translator's Back returns to where it was opened.

- [ ] **Step 3: Backend deploy**

Ask the user to deploy `sigla-backend` to Hostinger and restart the Node app. Then, on the phone, open Word Bank once (it refreshes the word bank) and re-check item 7 for a letter. Before the deploy, letters still work through the single-capital-letter fallback.

- [ ] **Step 4: Report** which items passed and any that failed.
