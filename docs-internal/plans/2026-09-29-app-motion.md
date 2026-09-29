# App-wide Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every screen transition, list, empty state and tappable card in the app consistent motion, reusing the translator's `Motion` kit.

**Architecture:** Timings are mirrored from `Motion` into `res/values/motion.xml` (a unit test keeps them equal). Screen transitions come from one theme-level `windowAnimationStyle`, tabs crossfade in `BottomNavHelper`. Lists play a once-only, capped stagger through a small `ListEntrance` helper; Home's hand-built rows use `Motion.reveal` with the same stagger. Presses use one `StateListAnimator`. Decisions (`shouldPlayListEntrance`, `staggerDelayMs`) are pure and unit-tested.

**Tech Stack:** Kotlin, Android Views, XML `anim`/`animator`/`interpolator` resources, `LayoutAnimationController`, JUnit 4. No new dependencies.

**Spec:** `docs-internal/specs/2026-09-29-app-motion-design.md`

## Global Constraints

- minSdk 24, compileSdk/targetSdk 34. **No new dependencies.**
- Timings: `motion_quick` 120, `motion_standard` 220 (= `Motion.QUICK`, `Motion.STANDARD`), `motion_screen_exit` 180, `motion_tab` 150, `motion_list_stagger` 40 (ms). Stagger cap: 8 items.
- Curves: `ENTER` `(0, 0, 0.2, 1)`, `EXIT` `(0.4, 0, 1, 1)`.
- Animate only alpha, translation and scale.
- List entrance plays **once per screen instance**, on the first non-empty data; never on tab return, scroll, search, filter or refresh.
- Tabs keep `FLAG_ACTIVITY_REORDER_TO_FRONT` (scroll position is preserved).
- Build/test from `sigla-mobile/` with `JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`. Unit tests are plain JVM (Android classes are stubs).
- Reference phone (MIUI, Android 15) blocks `adb shell input` and `settings put`; hands-on checks need the user. `MainActivity` is not exported.

## Review Focus

1. **Typing in a search box (Word Bank, category list)** — the list must update without replaying its entrance on every keystroke. Pinned by `onceAnEntranceHasPlayedItNeverPlaysAgain` (Task 1) and the Task 5 search check.
2. **Returning to Home from another tab** — Home re-renders its rows on every `onResume`; they must not stagger in again. Pinned by the Task 4 per-instance flags and the Task 5 "return to Home" check.
3. **A list that starts empty and gains data later** (History before the first translation; Word Bank before the word list downloads) — the entrance plays when data first arrives, not on the empty first layout. Pinned by `anEmptyListDoesNotSpendItsEntrance` (Task 1).
4. **Tapping tabs rapidly** — no screen left half-faded; each tab shows fully. Pinned by the Task 5 rapid-tab check.
5. **System "Remove animations"** — screen transitions, list entrance, empty states and press feedback all end in the correct state. Pinned by the Task 5 reduced-motion check.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src/main/res/values/motion.xml` | **New.** Integer timings mirrored from `Motion`. |
| `app/src/main/kotlin/com/example/sigla/ListMotion.kt` | **New.** `shouldPlayListEntrance`, `staggerDelayMs`, `LIST_STAGGER_CAP`, `ListEntrance`, `View.showEmptyState`. |
| `app/src/main/kotlin/com/example/sigla/Motion.kt` | **Modify.** Add `pop(view, peak)`. |
| `app/src/main/res/interpolator/motion_enter.xml`, `motion_exit.xml` | **New.** Curves. |
| `app/src/main/res/anim/screen_*.xml`, `tab_fade_*.xml`, `list_item_enter.xml` | **New.** Screen, tab and list-item animations. |
| `app/src/main/res/animator/press_scale.xml` | **New.** Press feedback. |
| `app/src/main/res/values/themes.xml` | **Modify.** `windowAnimationStyle`. |
| `app/src/main/res/values/styles_sigla.xml` | **Modify.** `Animation.Sigla.Screen`; press animator on `Widget.Sigla.Tab`. |
| `BottomNavHelper.kt` | **Modify.** Tab crossfade. |
| `HomeActivity.kt`, `WordBankActivity.kt`, `CategoryWordListActivity.kt`, `TranslationHistoryActivity.kt` | **Modify.** List entrance + empty states. |
| `WordDetailActivity.kt` | **Modify.** Favourite pop + tick. |
| `res/layout/item_category_card.xml`, `item_word_simple.xml`, `item_home_category.xml`, `item_home_recent.xml`, `view_bottom_nav.xml` | **Modify.** Press animator. |
| `app/src/test/.../MotionTokensTest.kt`, `ListEntranceTest.kt` | **New.** Tests. |
| `docs-internal/specs/2026-09-29-app-motion-design.md` | **Modify.** Record the four plan-time deviations (Task 1 Step 7). |

All paths below are relative to `sigla-mobile/` unless they start with `docs-internal/`.

---

### Task 1: Timings, list decisions and their tests

**Files:**
- Create: `app/src/main/res/values/motion.xml`
- Create: `app/src/main/kotlin/com/example/sigla/ListMotion.kt` (pure part only in this task)
- Test: `app/src/test/kotlin/com/example/sigla/MotionTokensTest.kt`, `app/src/test/kotlin/com/example/sigla/ListEntranceTest.kt`
- Modify: `docs-internal/specs/2026-09-29-app-motion-design.md`

**Interfaces:**
- Consumes: `Motion.QUICK: Long = 120`, `Motion.STANDARD: Long = 220` (existing).
- Produces: `R.integer.motion_quick`, `motion_standard`, `motion_screen_exit`, `motion_tab`, `motion_list_stagger`; `internal const val LIST_STAGGER_CAP = 8`; `internal fun shouldPlayListEntrance(alreadyPlayed: Boolean, itemCount: Int): Boolean`; `internal fun staggerDelayMs(index: Int, stepMs: Long, cap: Int = LIST_STAGGER_CAP): Long`.

- [ ] **Step 1: Write the failing tests**

`app/src/test/kotlin/com/example/sigla/ListEntranceTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ListEntranceTest {

    @Test
    fun theFirstNonEmptyDataPlaysTheEntrance() {
        assertTrue(shouldPlayListEntrance(alreadyPlayed = false, itemCount = 3))
    }

    @Test
    fun anEmptyListDoesNotSpendItsEntrance() {
        // History before the first translation: the entrance waits for real rows.
        assertFalse(shouldPlayListEntrance(alreadyPlayed = false, itemCount = 0))
    }

    @Test
    fun onceAnEntranceHasPlayedItNeverPlaysAgain() {
        // Search keystrokes, tab returns and refreshes all arrive with played = true.
        assertFalse(shouldPlayListEntrance(alreadyPlayed = true, itemCount = 12))
    }

    @Test
    fun staggerGrowsByOneStepPerItem() {
        assertEquals(0L, staggerDelayMs(0, 40))
        assertEquals(40L, staggerDelayMs(1, 40))
        assertEquals(280L, staggerDelayMs(7, 40))
    }

    @Test
    fun staggerStopsGrowingAtTheCapSoLongListsNeverWait() {
        assertEquals(280L, staggerDelayMs(8, 40))
        assertEquals(280L, staggerDelayMs(50, 40))
    }

    @Test
    fun aNegativeIndexIsTreatedAsTheFirstItem() {
        assertEquals(0L, staggerDelayMs(-1, 40))
    }
}
```

`app/src/test/kotlin/com/example/sigla/MotionTokensTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * XML animations cannot read Motion's Kotlin constants, so res/values/motion.xml
 * mirrors them. This fails if either side is edited alone.
 */
class MotionTokensTest {

    private val values: Map<String, Long> by lazy {
        // Unit tests run with the module directory (sigla-mobile/app) as cwd.
        val xml = File("src/main/res/values/motion.xml").readText()
        Regex("""<integer name="(\w+)">(\d+)</integer>""").findAll(xml)
            .associate { it.groupValues[1] to it.groupValues[2].toLong() }
    }

    @Test
    fun quickMatchesMotion() = assertEquals(Motion.QUICK, values["motion_quick"])

    @Test
    fun standardMatchesMotion() = assertEquals(Motion.STANDARD, values["motion_standard"])

    @Test
    fun theOtherTimingsHaveTheirSpecValues() {
        assertEquals(180L, values["motion_screen_exit"])
        assertEquals(150L, values["motion_tab"])
        assertEquals(40L, values["motion_list_stagger"])
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.ListEntranceTest" --tests "com.example.sigla.MotionTokensTest" -q
```
Expected: FAIL — `Unresolved reference: shouldPlayListEntrance` / `staggerDelayMs`.

- [ ] **Step 3: Write the timings and the pure decisions**

`app/src/main/res/values/motion.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Motion timings for XML animations. motion_quick and motion_standard MIRROR
     Motion.QUICK / Motion.STANDARD in Motion.kt; MotionTokensTest fails if they drift. -->
<resources>
    <integer name="motion_quick">120</integer>        <!-- Motion.QUICK -->
    <integer name="motion_standard">220</integer>     <!-- Motion.STANDARD -->
    <integer name="motion_screen_exit">180</integer>  <!-- closing is quicker than opening -->
    <integer name="motion_tab">150</integer>          <!-- tab crossfade -->
    <integer name="motion_list_stagger">40</integer>  <!-- delay between list items -->
</resources>
```

`app/src/main/kotlin/com/example/sigla/ListMotion.kt`:

```kotlin
package com.example.sigla

/** Items past this index share its delay, so a long list never waits to appear. */
internal const val LIST_STAGGER_CAP = 8

/**
 * A list plays its entrance once per screen instance, on its first non-empty
 * data. Search keystrokes, tab returns and refreshes arrive with it already
 * played; an empty first load does not spend it.
 */
internal fun shouldPlayListEntrance(alreadyPlayed: Boolean, itemCount: Int): Boolean =
    !alreadyPlayed && itemCount > 0

/** Start delay for the item at [index]: one [stepMs] per item, capped. */
internal fun staggerDelayMs(index: Int, stepMs: Long, cap: Int = LIST_STAGGER_CAP): Long =
    minOf(maxOf(index, 0), cap - 1) * stepMs
```

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: PASS (9 tests).

- [ ] **Step 5: Run the full suite**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest -q
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Record the plan-time deviations in the spec**

In `docs-internal/specs/2026-09-29-app-motion-design.md`, append a section:

```markdown
## 9. Plan-time decisions

- **Capped stagger is code, not XML.** `layout_list_enter.xml` is replaced by a
  small `LayoutAnimationController` subclass in `ListMotion.kt` that takes each
  item's delay from `staggerDelayMs`, because XML cannot express the 8-item cap.
- **Favourite pop is 1.06×, not 1.25×.** The favourite control is a full-width
  `MaterialButton` with a star icon, not a standalone star; 1.25× on the whole
  button would be jarring.
- **History rows get no press feedback.** `item_history_entry` is not tappable
  (only its delete button is), and §4.3 excludes non-tappable views.
- **`item_manage_category` is skipped.** No code inflates it any more (removed
  with the custom-category feature).
- **List items rise by 20% of their height, not 12dp.** View animations'
  `translate` does not accept `dp`; 20% of a word row is about 14dp.
```

- [ ] **Step 7: Commit**

```bash
git add sigla-mobile/app/src/main/res/values/motion.xml \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/ListMotion.kt \
        sigla-mobile/app/src/test/kotlin/com/example/sigla/ListEntranceTest.kt \
        sigla-mobile/app/src/test/kotlin/com/example/sigla/MotionTokensTest.kt \
        docs-internal/specs/2026-09-29-app-motion-design.md
git commit -m "feat(mobile): add motion timings and list-entrance rules"
```

---

### Task 2: Screen transitions and tab crossfade

**Files:**
- Create: `app/src/main/res/interpolator/motion_enter.xml`, `motion_exit.xml`
- Create: `app/src/main/res/anim/screen_open_enter.xml`, `screen_open_exit.xml`, `screen_close_enter.xml`, `screen_close_exit.xml`, `tab_fade_in.xml`, `tab_fade_out.xml`
- Modify: `app/src/main/res/values/styles_sigla.xml`, `app/src/main/res/values/themes.xml`, `app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt:65,75`

**Interfaces:**
- Consumes: `R.integer.motion_standard`, `motion_screen_exit`, `motion_tab` (Task 1).
- Produces: `R.interpolator.motion_enter`, `R.interpolator.motion_exit` (used by Task 4's `list_item_enter.xml`); `R.anim.tab_fade_in`, `R.anim.tab_fade_out`; style `Animation.Sigla.Screen`.

This task is XML plus two call sites; there is no pure logic to unit-test. It is verified by the build here and on device in Task 5.

- [ ] **Step 1: Curves**

`app/src/main/res/interpolator/motion_enter.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Motion.ENTER: decelerate, (0, 0, 0.2, 1). -->
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0" android:controlY1="0"
    android:controlX2="0.2" android:controlY2="1" />
```

`app/src/main/res/interpolator/motion_exit.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Motion.EXIT: accelerate, (0.4, 0, 1, 1). -->
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0.4" android:controlY1="0"
    android:controlX2="1" android:controlY2="1" />
```

- [ ] **Step 2: Screen and tab animations**

`app/src/main/res/anim/screen_open_enter.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- A screen being opened: rises slightly and fades in. -->
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_enter"
    android:shareInterpolator="true">
    <translate android:fromYDelta="6%" android:toYDelta="0%"
        android:duration="@integer/motion_standard" />
    <alpha android:fromAlpha="0" android:toAlpha="1"
        android:duration="@integer/motion_standard" />
</set>
```

`app/src/main/res/anim/screen_open_exit.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The screen underneath while another opens: dims a little. -->
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_enter"
    android:fromAlpha="1" android:toAlpha="0.85"
    android:duration="@integer/motion_standard" />
```

`app/src/main/res/anim/screen_close_enter.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The screen revealed on back: undims. -->
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_enter"
    android:fromAlpha="0.85" android:toAlpha="1"
    android:duration="@integer/motion_screen_exit" />
```

`app/src/main/res/anim/screen_close_exit.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- A screen being closed: sinks slightly and fades out. -->
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_exit"
    android:shareInterpolator="true">
    <translate android:fromYDelta="0%" android:toYDelta="6%"
        android:duration="@integer/motion_screen_exit" />
    <alpha android:fromAlpha="1" android:toAlpha="0"
        android:duration="@integer/motion_screen_exit" />
</set>
```

`app/src/main/res/anim/tab_fade_in.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_enter"
    android:fromAlpha="0" android:toAlpha="1"
    android:duration="@integer/motion_tab" />
```

`app/src/main/res/anim/tab_fade_out.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_exit"
    android:fromAlpha="1" android:toAlpha="0"
    android:duration="@integer/motion_tab" />
```

- [ ] **Step 3: Theme window animations**

In `app/src/main/res/values/styles_sigla.xml`, before `</resources>`:
```xml
    <!-- Every pushed screen opens and closes with the same motion (app-motion spec §4.1). -->
    <style name="Animation.Sigla.Screen" parent="@android:style/Animation.Activity">
        <item name="android:activityOpenEnterAnimation">@anim/screen_open_enter</item>
        <item name="android:activityOpenExitAnimation">@anim/screen_open_exit</item>
        <item name="android:activityCloseEnterAnimation">@anim/screen_close_enter</item>
        <item name="android:activityCloseExitAnimation">@anim/screen_close_exit</item>
    </style>
```

In `app/src/main/res/values/themes.xml`, inside `<style name="Theme.Sigla" …>`, after the `windowLightNavigationBar` item:
```xml
        <item name="android:windowAnimationStyle">@style/Animation.Sigla.Screen</item>
```

`app/src/main/res/values-night/themes.xml` redefines `Theme.Sigla` for dark mode, so add the same item inside its `<style name="Theme.Sigla" …>` too — otherwise dark mode keeps the device's default transitions.

- [ ] **Step 4: Tab crossfade**

In `BottomNavHelper.kt`, in both `open(...)` and `openWordBankSearch(...)`, replace
```kotlin
        activity.overridePendingTransition(0, 0)
```
with
```kotlin
        // Tabs crossfade instead of opening like a new screen (app-motion spec §4.1).
        activity.overridePendingTransition(R.anim.tab_fade_in, R.anim.tab_fade_out)
```

- [ ] **Step 5: Build and run the suite**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add sigla-mobile/app/src/main/res/interpolator sigla-mobile/app/src/main/res/anim \
        sigla-mobile/app/src/main/res/values/styles_sigla.xml sigla-mobile/app/src/main/res/values/themes.xml \
        sigla-mobile/app/src/main/res/values-night/themes.xml \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt
git commit -m "feat(mobile): screen open/close transitions and tab crossfade"
```

---

### Task 3: Press feedback and favourite pop

**Files:**
- Create: `app/src/main/res/animator/press_scale.xml`
- Modify: `item_category_card.xml`, `item_word_simple.xml`, `item_home_category.xml`, `item_home_recent.xml` (root element), `view_bottom_nav.xml` (`fabTranslate`), `styles_sigla.xml` (`Widget.Sigla.Tab`)
- Modify: `app/src/main/kotlin/com/example/sigla/Motion.kt`, `WordDetailActivity.kt` (`setupFavoriteButton`)

**Interfaces:**
- Consumes: `R.integer.motion_quick` (Task 1), `Haptics.tick(view)` (existing), `Motion.STANDARD`, `Motion.STANDARD_EASE` (existing).
- Produces: `R.animator.press_scale`; `Motion.pop(view: View, peak: Float = 1.06f)`.

The XML press effect has no JVM-testable logic; it is verified on device in Task 5. `Motion.pop` is view animation and likewise device-verified.

- [ ] **Step 1: The press animator**

`app/src/main/res/animator/press_scale.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Press feedback for tappable cards, rows, tabs and the translate button:
     settle to 97% while pressed (app-motion spec §3.3). -->
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <set>
            <objectAnimator android:propertyName="scaleX" android:valueTo="0.97"
                android:duration="@integer/motion_quick" android:valueType="floatType" />
            <objectAnimator android:propertyName="scaleY" android:valueTo="0.97"
                android:duration="@integer/motion_quick" android:valueType="floatType" />
        </set>
    </item>
    <item>
        <set>
            <objectAnimator android:propertyName="scaleX" android:valueTo="1"
                android:duration="@integer/motion_quick" android:valueType="floatType" />
            <objectAnimator android:propertyName="scaleY" android:valueTo="1"
                android:duration="@integer/motion_quick" android:valueType="floatType" />
        </set>
    </item>
</selector>
```

- [ ] **Step 2: Apply it**

Add this attribute to the **root element** of each of `item_category_card.xml`, `item_word_simple.xml`, `item_home_category.xml`, `item_home_recent.xml` (next to their existing `android:clickable="true"`):
```xml
    android:stateListAnimator="@animator/press_scale"
```
The three `MaterialCardView` roots already show a ripple when clickable; `item_home_recent`'s `LinearLayout` already has `?attr/selectableItemBackground`.

In `view_bottom_nav.xml`, on the `FloatingActionButton` with `android:id="@+id/fabTranslate"`, add:
```xml
        android:stateListAnimator="@animator/press_scale"
```
(This replaces the FAB's default press-elevation animator; the FAB keeps its ripple.)

In `styles_sigla.xml`, inside `<style name="Widget.Sigla.Tab" parent="">`, after the `android:background` item:
```xml
        <item name="android:stateListAnimator">@animator/press_scale</item>
```

- [ ] **Step 3: `Motion.pop`**

In `Motion.kt`, inside `object Motion`, after `stopPulse`:
```kotlin
    /**
     * A quick scale-up and back, for a toggle that just changed (favourite).
     * Starts from the current scale, so a second tap mid-pop re-pops cleanly.
     * Not for views with a press_scale animator: both would drive scale.
     */
    fun pop(view: View, peak: Float = 1.06f) {
        view.animate().cancel()
        view.animate().scaleX(peak).scaleY(peak)
            .setStartDelay(0).setDuration(STANDARD / 2).setInterpolator(STANDARD_EASE)
            .withEndAction {
                view.animate().scaleX(1f).scaleY(1f)
                    .setStartDelay(0).setDuration(STANDARD / 2).setInterpolator(STANDARD_EASE)
            }
    }
```

- [ ] **Step 4: Favourite pop and tick**

In `WordDetailActivity.setupFavoriteButton`, replace
```kotlin
            val isFavoriteNow = favoritesManager.toggle(w.id)
            refreshFavoriteButton(isFavoriteNow)
```
with
```kotlin
            val isFavoriteNow = favoritesManager.toggle(w.id)
            refreshFavoriteButton(isFavoriteNow)
            Motion.pop(btnAddToFavorites)
            Haptics.tick(btnAddToFavorites)
```

- [ ] **Step 5: Build and run the suite**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add sigla-mobile/app/src/main/res/animator/press_scale.xml sigla-mobile/app/src/main/res/layout \
        sigla-mobile/app/src/main/res/values/styles_sigla.xml \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/Motion.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/WordDetailActivity.kt
git commit -m "feat(mobile): press feedback on cards, tabs and translate; favourite pop"
```

---

### Task 4: List entrance and empty states

**Files:**
- Create: `app/src/main/res/anim/list_item_enter.xml`
- Modify: `ListMotion.kt` (view part), `HomeActivity.kt` (`renderCategories`, `renderRecent`), `WordBankActivity.kt`, `CategoryWordListActivity.kt`, `TranslationHistoryActivity.kt`

**Interfaces:**
- Consumes: `shouldPlayListEntrance`, `staggerDelayMs`, `R.integer.motion_list_stagger`, `motion_standard` (Task 1); `R.interpolator.motion_enter` (Task 2); `Motion.reveal(view, startDelay)`, `Motion.hideNow(view, visibility)` (existing).
- Produces: `class ListEntrance(list: RecyclerView)` with `fun onData(itemCount: Int)`; `fun View.showEmptyState(show: Boolean)`.

- [ ] **Step 1: List item animation**

`app/src/main/res/anim/list_item_enter.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- One list item arriving; ListEntrance staggers these (app-motion spec §4.2). -->
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@interpolator/motion_enter"
    android:shareInterpolator="true">
    <!-- 20% of the item's own height (~14dp on a word row); translate takes no dp. -->
    <translate android:fromYDelta="20%" android:toYDelta="0%"
        android:duration="@integer/motion_standard" />
    <alpha android:fromAlpha="0" android:toAlpha="1"
        android:duration="@integer/motion_standard" />
</set>
```

- [ ] **Step 2: View helpers in `ListMotion.kt`**

Append to `ListMotion.kt` (keep the pure functions above; add the imports at the top of the file):
```kotlin
import android.content.Context
import android.view.View
import android.view.animation.Animation
import android.view.animation.AnimationUtils
import android.view.animation.LayoutAnimationController
import androidx.recyclerview.widget.RecyclerView
```
```kotlin
/**
 * Plays a RecyclerView's staggered entrance once, on its first non-empty data.
 * Call [onData] every time the adapter's data is set.
 */
class ListEntrance(private val list: RecyclerView) {
    private var played = false

    fun onData(itemCount: Int) {
        if (!shouldPlayListEntrance(played, itemCount)) return
        played = true
        list.layoutAnimation = CappedListAnimation(list.context)
        list.setLayoutAnimationListener(object : Animation.AnimationListener {
            override fun onAnimationStart(animation: Animation?) = Unit
            override fun onAnimationRepeat(animation: Animation?) = Unit
            // Drop the controller once played, so later layouts (new rows,
            // filtering) can never pick it up again.
            override fun onAnimationEnd(animation: Animation?) {
                list.layoutAnimation = null
            }
        })
        list.scheduleLayoutAnimation()
    }
}

/** Layout animation whose per-item delay is [staggerDelayMs] — capped, unlike XML's. */
private class CappedListAnimation(context: Context) :
    LayoutAnimationController(AnimationUtils.loadAnimation(context, R.anim.list_item_enter), 0f) {

    private val stepMs = context.resources.getInteger(R.integer.motion_list_stagger).toLong()

    override fun getDelayForView(view: View): Long {
        val index = view.layoutParams?.layoutAnimationParameters?.index ?: 0
        return staggerDelayMs(index, stepMs)
    }
}

/** Empty states fade in rather than pop; hiding is instant (the list takes over). */
fun View.showEmptyState(show: Boolean) {
    if (show) {
        if (visibility != View.VISIBLE) Motion.reveal(this)
    } else {
        Motion.hideNow(this, View.GONE)
    }
}
```

- [ ] **Step 3: Word Bank**

In `WordBankActivity.kt`:

Add fields next to the other `lateinit` view fields:
```kotlin
    private lateinit var gridEntrance: ListEntrance
    private lateinit var wordsEntrance: ListEntrance
```
Right after `rvCategoryGrid.adapter = gridAdapter`:
```kotlin
        gridEntrance = ListEntrance(rvCategoryGrid)
```
Right after `rvWords.adapter = adapter`:
```kotlin
        wordsEntrance = ListEntrance(rvWords)
```
After `gridAdapter.setItems(items)` at the end of `refreshCategoryGrid()`:
```kotlin
        gridEntrance.onData(items.size)
```
After `adapter.setWords(filtered.toMutableList())` in `applyFilters()`:
```kotlin
        wordsEntrance.onData(filtered.size)
```
Replace the three places that **show** the empty state:
- in `refreshCategoryGrid()`: `emptyState.visibility = if (isLoading) View.GONE else View.VISIBLE` → `emptyState.showEmptyState(!isLoading)`
- in the load-failure branch (search `emptyState.visibility = View.VISIBLE`): → `emptyState.showEmptyState(true)`
- in `applyFilters()`: `emptyState.visibility = if (count == 0 && !isLoading) View.VISIBLE else View.GONE` → `emptyState.showEmptyState(count == 0 && !isLoading)`

Leave the plain `emptyState.visibility = View.GONE` lines as they are.

Order check: `gridEntrance`/`wordsEntrance` must be assigned before the first `refreshCategoryGrid()`/`applyFilters()` call. If either can run before the adapters are set up, declare them `private var … : ListEntrance? = null` and call with `?.onData(...)` instead.

- [ ] **Step 4: Category word list**

In `CategoryWordListActivity.kt`: add `private lateinit var wordsEntrance: ListEntrance`; after `rvCategoryWords.adapter = adapter` add `wordsEntrance = ListEntrance(rvCategoryWords)`; after `adapter.setWords(filtered)` in `applyFilters()` add `wordsEntrance.onData(filtered.size)`; replace
```kotlin
        emptyState.visibility = if (showEmpty) View.VISIBLE else View.GONE
```
with
```kotlin
        emptyState.showEmptyState(showEmpty)
```

- [ ] **Step 5: History**

In `TranslationHistoryActivity.kt`: add `private lateinit var historyEntrance: ListEntrance`; after the RecyclerView's adapter is assigned in `setupRecyclerView()` (`rvHistory.adapter = adapter`) add `historyEntrance = ListEntrance(rvHistory)`; in `refreshList()` after `adapter.setItems(items)` add `historyEntrance.onData(items.size)`; in `updateUI()` replace
```kotlin
        emptyState.visibility = if (count == 0) View.VISIBLE else View.GONE
```
with
```kotlin
        emptyState.showEmptyState(count == 0)
```

- [ ] **Step 6: Home (hand-built rows)**

In `HomeActivity.kt`, add fields:
```kotlin
    // Home rebuilds its rows on every onResume; they stagger in only the first
    // time this screen instance renders them (app-motion spec §4.2).
    private var categoriesEntrancePlayed = false
    private var recentEntrancePlayed = false
```

In `renderCategories`, replace
```kotlin
        grid.isVisible = categories.isNotEmpty()
        binding.tvCategoriesEmpty.isVisible = categories.isEmpty()
```
with
```kotlin
        grid.isVisible = categories.isNotEmpty()
        binding.tvCategoriesEmpty.showEmptyState(categories.isEmpty())
        val animate = shouldPlayListEntrance(categoriesEntrancePlayed, categories.size)
        if (animate) categoriesEntrancePlayed = true
        val stepMs = resources.getInteger(R.integer.motion_list_stagger).toLong()
```
and replace `grid.addView(item.root, params)` with
```kotlin
            if (animate) item.root.visibility = View.INVISIBLE
            grid.addView(item.root, params)
            if (animate) Motion.reveal(item.root, startDelay = staggerDelayMs(index, stepMs))
```

In `renderRecent`, replace
```kotlin
        binding.recentEmpty.isVisible = entries.isEmpty()
```
with
```kotlin
        binding.recentEmpty.showEmptyState(entries.isEmpty())
        val animate = shouldPlayListEntrance(recentEntrancePlayed, entries.size)
        if (animate) recentEntrancePlayed = true
        val stepMs = resources.getInteger(R.integer.motion_list_stagger).toLong()
```
change `for (entry in entries) {` to `for ((index, entry) in entries.withIndex()) {`, and replace `binding.listRecent.addView(row.root)` with
```kotlin
            if (animate) row.root.visibility = View.INVISIBLE
            binding.listRecent.addView(row.root)
            if (animate) Motion.reveal(row.root, startDelay = staggerDelayMs(index, stepMs))
```
Add `import android.view.View` if not present.

- [ ] **Step 7: Build and run the suite**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/res/anim/list_item_enter.xml \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/ListMotion.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/HomeActivity.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/WordBankActivity.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/CategoryWordListActivity.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/TranslationHistoryActivity.kt
git commit -m "feat(mobile): once-only list entrance and empty-state reveal"
```

---

### Task 5: On-device verification

**Files:** none unless a check fails (then fix in the owning task's file).

- [ ] **Step 1: Baseline (before installing)** — the phone runs the current `main` build (1.3.0 release). Ask the user to scroll Word Bank and History and switch tabs for ~30 s, then:
```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
PID=$("$ADB" shell pidof com.example.sigla)
"$ADB" logcat -d -v epoch --pid="$PID" | grep -cE "Choreographer.*Skipped|Davey"
```
(Take the count over the last ~45 s by timestamp, as in the translator round.) If the phone has the release build and the new build is debug-signed, the user must uninstall first — ask before doing so; it clears app data.

- [ ] **Step 2: Install** the new debug build; if a fresh install is refused (`INSTALL_FAILED_USER_RESTRICTED`), `adb push` it to `/sdcard/Download/` for the user to open.

- [ ] **Step 3: Performance** — repeat Step 1's session on the new build. Expected: no more skipped/Davey entries than baseline.

- [ ] **Step 4: User checklist** (ask the user; record answers):
1. Open a word, a category and the translator; press Back each time: rise-and-fade in, sink-and-fade out — **not** MIUI's zoom. If MIUI's zoom shows, apply the spec §4.1 fallback (`overridePendingTransition(R.anim.screen_open_enter, R.anim.screen_open_exit)` after each push, and the close pair in each pushed screen's `finish()`), then re-check.
2. Switch tabs: quick crossfade; each tab keeps its scroll position. **Tap tabs rapidly**: nothing stays half-faded (Review Focus 4).
3. First open of Word Bank / a category / History: items stagger in. Return to the tab, scroll, **type in search**: no replay (Review Focus 1).
4. Home: categories and recents stagger in on first open; switch tabs and come back: **no replay** (Review Focus 2).
5. Press each: word tile, category card, Home category, Home recent, tab, translate button — each settles slightly and springs back.
6. Favourite a word: the button pops with a light tick.
7. Empty states (History with no entries, a search with no results): fade in.
8. **Remove animations on** (Settings → Accessibility → Remove animations, or Developer options → Animator duration scale off): repeat 1–4 quickly — everything appears instantly and ends in the correct state; turn it back on (Review Focus 5). If list entrance still animates with it on, add the spec §6 `animationsEnabled` input to `shouldPlayListEntrance` (test first), then re-check.

- [ ] **Step 5: Push the branch** only when the user asks.
