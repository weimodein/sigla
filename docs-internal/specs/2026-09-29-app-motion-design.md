# App-wide Motion — Design

**Date:** 2026-09-29
**Status:** Approved in design review, pending spec review
**Area:** sigla-mobile
**Builds on:** `2026-09-29-translator-motion-design.md` (the `Motion` kit, tokens, easing)

## 1. Goal

Extend the translator's motion to the rest of the app so navigation, content
and touches all respond, guiding attention and giving a consistent, polished
feel. Three areas, designed and tuned together:

1. **Screen transitions** — opening/closing screens and switching tabs.
2. **Content entrance** — lists and empty states arriving.
3. **Touch feedback** — every tappable card/row responds to a press.

### Today

| Area | Today |
|---|---|
| Opening a screen | Device default (MIUI's own zoom on the reference phone) |
| Tab switch | Deliberately instant (`overridePendingTransition(0, 0)`) |
| Lists | Appear all at once |
| Touch | Ripple on only Settings rows, Home recents, manage-category rows; word tiles, category cards and history rows give no press response |
| Favourite star | Icon swaps instantly |
| Empty states | Pop in |

### Success criteria

- Every pushed screen opens and closes with the same motion; tabs crossfade.
- Lists animate in once when first loaded, and never replay on tab return,
  scroll, search or filter.
- Every tappable card, row and tab visibly responds to a press.
- No new skipped frames (logcat `Choreographer: Skipped` / `Davey`) while
  scrolling Word Bank and History or switching tabs.
- With system "Remove animations" on, every screen and list ends in its
  correct state (verified on device — see §6).
- The reference phone (MIUI) shows the app's transitions, not MIUI's.

## 2. Approach

Theme-level window animations plus shared XML animation resources and one
pressable style, all using the `Motion` tokens. No new dependencies.
Rejected: per-screen code wiring (timings drift, screens get missed) and a
single-activity/Navigation-component migration (restructures every screen
for polish).

## 3. Shared pieces

### 3.1 Timings

Reuse `Motion` tokens. XML resources cannot read Kotlin constants, so the
values are mirrored in `res/values/motion.xml` as integers, each with a
comment naming its `Motion` token:

| Resource | ms | Mirrors |
|---|---|---|
| `motion_quick` | 120 | `Motion.QUICK` |
| `motion_standard` | 220 | `Motion.STANDARD` |
| `motion_screen_exit` | 180 | — (closing is faster than opening) |
| `motion_tab` | 150 | — (tab crossfade) |
| `motion_list_stagger` | 40 | — (delay between list items) |

A unit test asserts `motion.xml`'s mirrored values equal the Kotlin tokens,
by parsing the XML file, so the two cannot drift.

### 3.2 Animation resources (`res/anim/`)

| File | Motion |
|---|---|
| `screen_open_enter.xml` | New screen: translateY 6%→0 + alpha 0→1, `motion_standard`, decelerate (`ENTER` curve) |
| `screen_open_exit.xml` | Screen underneath: alpha 1→0.85, `motion_standard` |
| `screen_close_enter.xml` | Screen revealed on back: alpha 0.85→1, `motion_screen_exit` |
| `screen_close_exit.xml` | Closing screen: translateY 0→6% + alpha 1→0, `motion_screen_exit`, accelerate (`EXIT` curve) |
| `tab_fade_in.xml` / `tab_fade_out.xml` | alpha 0→1 / 1→0, `motion_tab` |
| `list_item_enter.xml` | alpha 0→1 + translateY 12dp→0, `motion_standard`, decelerate |
| `layout_list_enter.xml` | `layoutAnimation` over `list_item_enter`, delay `motion_list_stagger` per item |

Curves are `PathInterpolator` resources in `res/interpolator/` matching
`Motion.ENTER` and `Motion.EXIT`.

### 3.3 Pressable style

- `res/animator/press_scale.xml` — a `StateListAnimator`: pressed →
  scaleX/Y 0.97 over `motion_quick`; otherwise → 1.0 over `motion_quick`.
- `Widget.Sigla.Pressable` style: `android:stateListAnimator` =
  `@animator/press_scale`, plus a ripple foreground
  (`?attr/selectableItemBackground`) where the view has none.

## 4. Behaviour

### 4.1 Screen transitions

- `Theme.Sigla` gets `android:windowAnimationStyle` =
  `@style/Animation.Sigla.Screen`, mapping `activityOpenEnter/Exit` and
  `activityCloseEnter/Exit` to §3.2. Every activity inherits it, including
  `Theme.Sigla.Immersive` (translator, fullscreen video) and onboarding.
- `BottomNavHelper.open` and `openWordBankSearch`: replace
  `overridePendingTransition(0, 0)` with `tab_fade_in` / `tab_fade_out`.
  Tabs still use `FLAG_ACTIVITY_REORDER_TO_FRONT` and keep scroll position.
- `SplashActivity` keeps its own fade.
- **MIUI check:** if the reference phone ignores the theme's window
  animations, fall back to `overridePendingTransition` on each push and in
  `finish()` of pushed screens (decided on device in the plan's device task).

### 4.2 Content entrance

- **RecyclerViews** — `rvCategoryGrid`, `rvWords` (Word Bank),
  `rvCategoryWords` (category list), `rvHistory` (History): run
  `layout_list_enter` **once**, on the first non-empty data set of that
  screen instance, via `scheduleLayoutAnimation()`.
- **Home** — `gridCategories` and `listRecent` are rebuilt with `addView` on
  every `onResume`. Stagger them in with `Motion.reveal` (delay =
  index × stagger, capped) on the **first** render of the activity instance
  only.
- **Never replays** on tab return (instance reused), scroll, search, filter
  or refresh.
- **Stagger cap:** at most 8 items animate with increasing delay; items
  beyond the 8th use the 8th's delay, so a long list never waits.
- **Empty states** — `emptyState` (Word Bank, category list, History),
  `tvCategoriesEmpty`, `recentEmpty` (Home): shown with `Motion.reveal`
  instead of an instant visibility change.

The decision is pure and tested, in `ListMotion.kt`:

```kotlin
internal fun shouldPlayListEntrance(alreadyPlayed: Boolean, itemCount: Int): Boolean =
    !alreadyPlayed && itemCount > 0

internal fun staggerDelayMs(index: Int, stepMs: Long, cap: Int = 8): Long =
    minOf(index, cap - 1) * stepMs
```

### 4.3 Touch feedback

- Apply `Widget.Sigla.Pressable` (or its animator, where the view already
  has a style) to the tappable roots of: `item_category_card`,
  `item_word_simple`, `item_home_category`, `item_home_recent`,
  `item_history_entry`, `item_manage_category`, and the bottom-nav tabs
  (`Widget.Sigla.Tab`, which already has a borderless ripple) and the centre
  translate button (`fabTranslate`).
- **Favourite star** (`WordDetailActivity.btnAddToFavorites`): on toggle, a
  pop — scale 1→1.25→1 over `Motion.STANDARD` — plus `Haptics.tick`.
  Added to `Motion` as `pop(view)`.
- Not included: non-tappable views; MaterialButtons (already have ripple).

## 5. Performance

Only alpha, translation and scale animate. List entrance plays once per
screen instance, never during scroll. Check: logcat skipped frames / Davey
while scrolling Word Bank and History and switching tabs, before and after,
on the reference phone. No new entries is the bar.

## 6. Reduced motion

`ViewPropertyAnimator` and `StateListAnimator` follow the system animator
scale. Window animations and `LayoutAnimation` use the older `Animation`
system, whose scaling is governed by the system's transition/animator
settings — **verified on device**, not assumed. If "Remove animations" still
plays list entrance, `shouldPlayListEntrance` gains an
`animationsEnabled` input read from `Settings.Global.ANIMATOR_DURATION_SCALE`.

## 7. Testing

- **Unit (JVM):** `shouldPlayListEntrance`, `staggerDelayMs` (including the
  cap), and the `motion.xml` ↔ `Motion` token mirror.
- **On device:** open/back on word detail, category list, translator,
  fullscreen video; tab crossfade and preserved scroll; list entrance on
  first load only (return to tab, scroll, search do not replay); press
  feedback on each item type, tabs and the translate button; favourite pop
  + tick; MIUI shows our transitions; reduced motion; no new skipped frames.

## 8. Files

| File | Change |
|---|---|
| `res/values/motion.xml` | New — mirrored timings. |
| `res/anim/*.xml`, `res/interpolator/*.xml`, `res/animator/press_scale.xml` | New — §3.2, §3.3. |
| `res/values/themes.xml`, `res/values/styles_sigla.xml` | Window animation style, `Widget.Sigla.Pressable`, tab style. |
| `BottomNavHelper.kt` | Tab crossfade. |
| `Motion.kt` | `pop(view)`. |
| `ListMotion.kt` | New — `shouldPlayListEntrance`, `staggerDelayMs`. |
| `HomeActivity.kt`, `WordBankActivity.kt`, `CategoryWordListActivity.kt`, `TranslationHistoryActivity.kt` | First-load list entrance, empty-state reveal. |
| `WordDetailActivity.kt` | Favourite pop + tick. |
| `res/layout/item_*.xml`, `view_bottom_nav.xml` | Pressable style on tappable roots. |
| Tests | `ListEntranceTest.kt`, `MotionTokensTest.kt`. |

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
- **No `Widget.Sigla.Pressable` style.** §3.3 named a shared style, but each
  tappable root already had its own `style=` attribute (card styles, the tab
  style), so `android:stateListAnimator="@animator/press_scale"` was added
  directly to each root/style instead of introducing a style that would have
  had to be layered on top of an existing one.
