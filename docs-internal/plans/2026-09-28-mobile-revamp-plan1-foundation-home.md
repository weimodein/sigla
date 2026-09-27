# Mobile Revamp — Plan 1: Design System, Home, Bottom Bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sigla-mobile its new navy design system, a Home dashboard as the launch screen, and a bottom tab bar with a centre Translate button, replacing the side drawer everywhere.

**Architecture:** New colour/type/spacing/component resources (`sg_*` colours, `Sigla.Text.*` and `Widget.Sigla.*` styles) sit alongside the old `sig_*` ones so untouched screens keep working. A new `HomeActivity` becomes the launcher; its data logic lives in pure-Kotlin functions (`HomeContent.kt`) with unit tests. A shared `view_bottom_nav.xml` (Material `BottomAppBar` + docked `FloatingActionButton`) is included in each tab screen's existing `CoordinatorLayout`, wired by `BottomNavHelper`. The translator (`MainActivity`) loses its drawer and gains a back button.

**Tech Stack:** Kotlin, Android Views + XML, viewBinding, Material Components 1.11, JUnit 4.

**Spec:** `docs-internal/specs/2026-09-28-mobile-ui-revamp-design.md` (mockups in `docs-internal/specs/2026-09-28-mobile-ui-revamp/`). This plan implements the spec's build-order phases **1 and 2** only. Phases 3–7 (translator restyle, Word Bank/word screens, History/Settings, onboarding, dark pass) get Plan 2, written after this lands against the real components created here.

## Global Constraints

- Brand navy `#13306B` (light) / `#2A55B8` (dark); brand text `#13306B` / `#9DB8F2`; background `#FFFFFF` / `#0B1530`; tint `#EEF3FC` / `#15244B`; bottom bar `#FFFFFF` / `#101D3F`; text `#0F1B33` / `#E8EDF7`; secondary text = text colour at 62% alpha; divider `#13306B` @ 8% / `#FFFFFF` @ 6%; danger `#E53935`; success `#2E7D32`.
- Poppins only; sizes 22sp (title), 17sp (card title/section), 13sp (body), 11sp (caption), plus 26sp display reserved for word detail (Plan 2); weights Regular and SemiBold only in new UI.
- Spacing from {4, 8, 12, 16, 20, 24, 32}dp; screen side padding 20dp; radii 24dp (large cards), 20dp (small cards), 16dp (buttons/chips); tap targets ≥ 48dp.
- Red is only for recording, SOS and destructive actions.
- `AppSettings.isDarkMode` default becomes `false`; a stored `true` is preserved.
- Home reads only on-device data and never triggers a network call.
- Greeting: morning before 12:00, afternoon 12:00–17:59, evening from 18:00; with a name: title "Hi {name}!", subtitle the time line; without a name (null or blank after trim): title is the time line, no subtitle.
- Home stats: Today (history entries on today's local date) · Saved (history entry count) · Favorites (`FavoritesManager` count).
- Home categories: up to 4, only categories with ≥ 1 word, ordered by word count descending then name ascending (case-insensitive); word counts come from the cached word bank.
- Tap-to-sign logic (`TapSignSession`, `ClipPreparer`, frame routing, `processCapture`, cancel call sites) must not be modified.
- Old `sig_*` colours and `styles.xml` stay untouched in this plan; screens migrate to `sg_*` in Plan 2.
- Commit messages end with the co-author trailer your session's attribution instructions specify.

**Clarification of the spec (translator back):** the translator's back button calls `finish()`, returning to whichever screen opened it — Home when opened from Home's hero card or centre button on Home, otherwise the tab it was opened from. The spec's "back arrow to Home" assumed it is always opened from Home.

## Environment

- Kotlin tests, from `sigla-mobile/` in Git Bash (Java is not on PATH):
  `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && ./gradlew testDebugUnitTest`
  One class: append `--tests com.example.sigla.HomeContentTest`.
- Build: same prefix, `./gradlew assembleDebug`.
- Install on the phone: `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk`. If it fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the phone has a differently-signed build: uninstall `com.example.sigla` first (this wipes local history/favorites on that phone — ask the user before doing it).
- Baseline: 63 Kotlin unit tests pass on `main`.

## Review Focus

1. **Existing user who turned dark mode on** — after upgrading they must still get dark mode (their stored `true` is kept); only never-touched installs switch to light. Pinned by the device check in Task 1 Step 9.
2. **First launch with no cached word bank (offline)** — Home must show the "Connect to the internet once…" message, not an empty gap or a crash. Pinned by `homeCategoriesEmptyWhenNoWords` (Task 3) and the device check in Task 8.
3. **Translations just before/after midnight and across years** — "Today" must count by local calendar date, not "last 24 hours" or day-of-year alone. Pinned by `todayCountsByLocalCalendarDate` (Task 3).
4. **Name that is only spaces** — must behave like no name (no "Hi   !"). Pinned by `blankNameTreatedAsNoName` (Task 3).
5. **Back button from a tab** — must never dead-end or loop between tabs: Word Bank list → Word Bank grid → Home; History/Settings → Home; Home → leaves the app. Pinned by the device check in Task 6 Step 9.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/src/main/res/values/colors_sigla.xml` | Create | New `sg_*` light colour tokens |
| `app/src/main/res/values-night/colors_sigla.xml` | Create | `sg_*` dark overrides |
| `app/src/main/res/values/dimens_sigla.xml` | Create | Spacing, radii, sizes, text sizes |
| `app/src/main/res/values/styles_sigla.xml` | Create | Text, card, button, bottom bar, tab styles |
| `app/src/main/res/values/themes.xml` | Modify | Rebrand `Theme.Sigla`; add `Theme.Sigla.Immersive` |
| `app/src/main/res/values-night/themes.xml` | Create | Dark status-bar icon setting |
| `app/src/main/res/font/poppins_semibold.ttf` | Add | SemiBold weight |
| `app/src/main/res/drawable/bg_sg_search.xml`, `bg_sg_circle_tint.xml` | Create | Search pill, round badge |
| `app/src/main/res/drawable/ic_search_line.xml`, `ic_hand_line.xml`, `ic_chat_line.xml` | Create | Icons in the existing outline style |
| `app/src/main/kotlin/com/example/sigla/AppSettings.kt` | Modify | Dark default `false`; `userName` |
| `app/src/main/kotlin/com/example/sigla/HomeContent.kt` | Create | Pure Home logic |
| `app/src/test/kotlin/com/example/sigla/HomeContentTest.kt` | Create | Tests for Home logic |
| `app/src/main/res/layout/view_bottom_nav.xml` | Create | Bottom bar + centre button (`<merge>`) |
| `app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt` | Create | Tab wiring and navigation |
| `app/src/test/kotlin/com/example/sigla/BottomNavHelperTest.kt` | Create | Tab → screen mapping |
| `app/src/main/res/layout/activity_home.xml`, `item_home_category.xml`, `item_home_recent.xml` | Create | Home UI |
| `app/src/main/res/values/strings.xml` | Modify | Word-count plural |
| `app/src/main/kotlin/com/example/sigla/HomeActivity.kt` | Create | Home screen |
| `app/src/main/AndroidManifest.xml` | Modify | Launcher → Home; themes |
| `app/src/main/kotlin/com/example/sigla/OnboardingActivity.kt` | Modify | Finish → Home |
| `activity_word_bank.xml`, `activity_translation_history.xml`, `activity_settings.xml` + their Activities | Modify | Drawer → bottom bar |
| `activity_main.xml`, `MainActivity.kt` | Modify | Drawer → back button; onboarding gate removed |
| `NavigationHelper.kt`, `nav_sidebar.xml` | Delete | Replaced |

All paths below are relative to `sigla-mobile/` unless absolute.

---

### Task 1: Design tokens, theme, SemiBold font, dark-mode default

**Files:**
- Create: `app/src/main/res/values/colors_sigla.xml`, `app/src/main/res/values-night/colors_sigla.xml`, `app/src/main/res/values/dimens_sigla.xml`, `app/src/main/res/values/styles_sigla.xml`, `app/src/main/res/values-night/themes.xml`, `app/src/main/res/drawable/bg_sg_search.xml`, `app/src/main/res/drawable/bg_sg_circle_tint.xml`
- Add: `app/src/main/res/font/poppins_semibold.ttf`
- Modify: `app/src/main/res/values/themes.xml`, `app/src/main/kotlin/com/example/sigla/AppSettings.kt`, `app/src/main/AndroidManifest.xml` (themes only)

**Interfaces:**
- Produces (used by every later task): colours `sg_brand`, `sg_brand_text`, `sg_bg`, `sg_tint`, `sg_bar_bg`, `sg_text`, `sg_text_secondary`, `sg_divider`, `sg_danger`, `sg_success`, `sg_on_brand`, `sg_on_brand_secondary`; dimens `sg_space_4/8/12/16/20/24/32`, `sg_screen_padding`, `sg_radius_lg/md/sm`, `sg_text_title/card/body/caption/display`, `sg_badge_size`, `sg_search_height`, `sg_touch_min`, `sg_bottom_bar_height`, `sg_bottom_bar_clearance`; styles `Sigla.Text.{Title,Section,CardTitle,Body,BodyStrong,Secondary,Caption,Link,StatValue,StatLabel,Display}`, `Widget.Sigla.{Button,Card.Tint,Card.Brand,Card.Outlined,BottomAppBar,Tab,TabIcon,TabLabel}`; drawables `bg_sg_search`, `bg_sg_circle_tint`; font `@font/poppins_semibold`; theme `Theme.Sigla.Immersive`.

- [ ] **Step 1: Add the SemiBold font**

Run from `sigla-mobile/`:
```bash
curl -L -o app/src/main/res/font/poppins_semibold.ttf https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf
ls -l app/src/main/res/font/poppins_semibold.ttf
```
Expected: a file of about 157,000 bytes (not a few hundred bytes of HTML). Poppins is SIL Open Font License, same as the fonts already bundled.

- [ ] **Step 2: Light colour tokens**

Create `app/src/main/res/values/colors_sigla.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Revamp design tokens (spec §4). Screens migrate from the older sig_* colours
     to these; dark values live in values-night/colors_sigla.xml. -->
<resources>
    <color name="sg_brand">#13306B</color>
    <color name="sg_brand_text">#13306B</color>
    <color name="sg_bg">#FFFFFF</color>
    <color name="sg_tint">#EEF3FC</color>
    <color name="sg_bar_bg">#FFFFFF</color>
    <color name="sg_text">#0F1B33</color>
    <!-- 62% of sg_text -->
    <color name="sg_text_secondary">#9E0F1B33</color>
    <!-- 8% of brand -->
    <color name="sg_divider">#1413306B</color>
    <color name="sg_danger">#E53935</color>
    <color name="sg_success">#2E7D32</color>
    <color name="sg_on_brand">#FFFFFF</color>
    <color name="sg_on_brand_secondary">#CCFFFFFF</color>
</resources>
```

- [ ] **Step 3: Dark colour tokens**

Create `app/src/main/res/values-night/colors_sigla.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sg_brand">#2A55B8</color>
    <color name="sg_brand_text">#9DB8F2</color>
    <color name="sg_bg">#0B1530</color>
    <color name="sg_tint">#15244B</color>
    <color name="sg_bar_bg">#101D3F</color>
    <color name="sg_text">#E8EDF7</color>
    <color name="sg_text_secondary">#9EE8EDF7</color>
    <!-- 6% white -->
    <color name="sg_divider">#0FFFFFFF</color>
    <color name="sg_danger">#E53935</color>
    <color name="sg_success">#2E7D32</color>
    <color name="sg_on_brand">#FFFFFF</color>
    <color name="sg_on_brand_secondary">#CCFFFFFF</color>
</resources>
```

- [ ] **Step 4: Dimensions**

Create `app/src/main/res/values/dimens_sigla.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 8-point spacing scale -->
    <dimen name="sg_space_4">4dp</dimen>
    <dimen name="sg_space_8">8dp</dimen>
    <dimen name="sg_space_12">12dp</dimen>
    <dimen name="sg_space_16">16dp</dimen>
    <dimen name="sg_space_20">20dp</dimen>
    <dimen name="sg_space_24">24dp</dimen>
    <dimen name="sg_space_32">32dp</dimen>
    <dimen name="sg_screen_padding">20dp</dimen>

    <dimen name="sg_radius_lg">24dp</dimen>
    <dimen name="sg_radius_md">20dp</dimen>
    <dimen name="sg_radius_sm">16dp</dimen>

    <dimen name="sg_text_title">22sp</dimen>
    <dimen name="sg_text_card">17sp</dimen>
    <dimen name="sg_text_body">13sp</dimen>
    <dimen name="sg_text_caption">11sp</dimen>
    <!-- Word detail only (Plan 2) -->
    <dimen name="sg_text_display">26sp</dimen>

    <dimen name="sg_badge_size">40dp</dimen>
    <dimen name="sg_search_height">44dp</dimen>
    <dimen name="sg_touch_min">48dp</dimen>

    <dimen name="sg_bottom_bar_height">64dp</dimen>
    <!-- Bottom padding for scrolling content so the bar and the raised centre
         button never cover the last item. -->
    <dimen name="sg_bottom_bar_clearance">96dp</dimen>
</resources>
```

- [ ] **Step 5: Component styles**

Create `app/src/main/res/values/styles_sigla.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- ── Text ── (4 sizes, 2 weights; spec §4) -->
    <style name="Sigla.Text">
        <item name="android:fontFamily">@font/poppins_regular</item>
        <item name="android:textSize">@dimen/sg_text_body</item>
        <item name="android:textColor">@color/sg_text</item>
    </style>
    <style name="Sigla.Text.Title">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_title</item>
        <item name="android:textColor">@color/sg_brand_text</item>
    </style>
    <style name="Sigla.Text.Section">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_card</item>
    </style>
    <style name="Sigla.Text.CardTitle">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_card</item>
        <item name="android:textColor">@color/sg_brand_text</item>
    </style>
    <style name="Sigla.Text.Body" />
    <style name="Sigla.Text.BodyStrong">
        <item name="android:fontFamily">@font/poppins_semibold</item>
    </style>
    <style name="Sigla.Text.Secondary">
        <item name="android:textColor">@color/sg_text_secondary</item>
    </style>
    <style name="Sigla.Text.Caption">
        <item name="android:textSize">@dimen/sg_text_caption</item>
        <item name="android:textColor">@color/sg_text_secondary</item>
    </style>
    <style name="Sigla.Text.Link">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_caption</item>
        <item name="android:textColor">@color/sg_text_secondary</item>
    </style>
    <style name="Sigla.Text.StatValue">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_title</item>
        <item name="android:textColor">@color/sg_on_brand</item>
    </style>
    <style name="Sigla.Text.StatLabel">
        <item name="android:textSize">@dimen/sg_text_caption</item>
        <item name="android:textColor">@color/sg_on_brand_secondary</item>
    </style>
    <style name="Sigla.Text.Display">
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_display</item>
        <item name="android:textColor">@color/sg_brand_text</item>
    </style>

    <!-- ── Buttons ── -->
    <style name="Widget.Sigla.Button" parent="Widget.MaterialComponents.Button">
        <item name="backgroundTint">@color/sg_brand</item>
        <item name="android:textColor">@color/sg_on_brand</item>
        <item name="cornerRadius">@dimen/sg_radius_sm</item>
        <item name="android:textAllCaps">false</item>
        <item name="android:fontFamily">@font/poppins_semibold</item>
        <item name="android:textSize">@dimen/sg_text_body</item>
        <item name="android:letterSpacing">0</item>
        <item name="android:insetTop">0dp</item>
        <item name="android:insetBottom">0dp</item>
        <item name="android:minHeight">@dimen/sg_touch_min</item>
    </style>

    <!-- ── Cards ── -->
    <style name="Widget.Sigla.Card" parent="Widget.MaterialComponents.CardView">
        <item name="cardElevation">0dp</item>
        <item name="cardCornerRadius">@dimen/sg_radius_md</item>
        <item name="cardBackgroundColor">@color/sg_tint</item>
        <item name="strokeWidth">0dp</item>
    </style>
    <style name="Widget.Sigla.Card.Tint" />
    <style name="Widget.Sigla.Card.Brand">
        <item name="cardCornerRadius">@dimen/sg_radius_lg</item>
        <item name="cardBackgroundColor">@color/sg_brand</item>
    </style>
    <style name="Widget.Sigla.Card.Outlined">
        <item name="cardCornerRadius">@dimen/sg_radius_lg</item>
        <item name="cardBackgroundColor">@color/sg_bg</item>
        <item name="strokeColor">@color/sg_divider</item>
        <item name="strokeWidth">1dp</item>
    </style>

    <!-- ── Bottom bar ── -->
    <style name="Widget.Sigla.BottomAppBar" parent="Widget.MaterialComponents.BottomAppBar">
        <item name="backgroundTint">@color/sg_bar_bg</item>
        <item name="fabAlignmentMode">center</item>
        <item name="fabCradleMargin">6dp</item>
        <item name="fabCradleRoundedCornerRadius">12dp</item>
        <item name="fabCradleVerticalOffset">0dp</item>
        <item name="contentInsetStart">0dp</item>
        <item name="contentInsetEnd">0dp</item>
        <item name="contentInsetStartWithNavigation">0dp</item>
        <item name="elevation">8dp</item>
    </style>
    <style name="Widget.Sigla.Tab">
        <item name="android:layout_width">0dp</item>
        <item name="android:layout_height">match_parent</item>
        <item name="android:layout_weight">1</item>
        <item name="android:orientation">vertical</item>
        <item name="android:gravity">center</item>
        <item name="android:clickable">true</item>
        <item name="android:focusable">true</item>
        <item name="android:background">?attr/selectableItemBackgroundBorderless</item>
    </style>
    <style name="Widget.Sigla.TabIcon">
        <item name="android:layout_width">24dp</item>
        <item name="android:layout_height">24dp</item>
        <item name="android:importantForAccessibility">no</item>
    </style>
    <style name="Widget.Sigla.TabLabel" parent="Sigla.Text.Caption">
        <item name="android:layout_width">wrap_content</item>
        <item name="android:layout_height">wrap_content</item>
        <item name="android:layout_marginTop">2dp</item>
        <item name="android:maxLines">1</item>
    </style>
</resources>
```
Note: dotted style names (`Sigla.Text.Title`) inherit from their prefix (`Sigla.Text`), so every text style starts from Poppins Regular 13sp `sg_text`.

- [ ] **Step 6: Shape drawables**

Create `app/src/main/res/drawable/bg_sg_search.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/sg_tint" />
    <corners android:radius="22dp" />
</shape>
```
Create `app/src/main/res/drawable/bg_sg_circle_tint.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="@color/sg_tint" />
</shape>
```

- [ ] **Step 7: Themes**

Replace the whole content of `app/src/main/res/values/themes.xml` with:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- App theme: navy brand, light by default (spec §4). windowBackground matches
         the Home screen so the starting window and the first frame are the same
         colour (a mismatch reads as a stutter on launch). -->
    <style name="Theme.Sigla" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="colorPrimary">@color/sg_brand</item>
        <item name="colorPrimaryVariant">@color/sg_brand</item>
        <item name="colorOnPrimary">@color/sg_on_brand</item>
        <item name="colorSecondary">@color/sg_brand</item>
        <item name="colorOnSecondary">@color/sg_on_brand</item>
        <item name="android:windowBackground">@color/sg_bg</item>
        <item name="android:statusBarColor">@color/sg_bg</item>
        <item name="android:navigationBarColor">@color/sg_bar_bg</item>
        <item name="android:windowLightStatusBar">true</item>
    </style>

    <!-- Translator and fullscreen video: always dark, like a camera or video app.
         These are the values Theme.Sigla had before the revamp. -->
    <style name="Theme.Sigla.Immersive">
        <item name="android:windowBackground">#08162a</item>
        <item name="android:statusBarColor">#0A0E21</item>
        <item name="android:navigationBarColor">#0D1127</item>
        <item name="android:windowLightStatusBar">false</item>
    </style>
</resources>
```
Create `app/src/main/res/values-night/themes.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Light status-bar icons on the dark background. -->
    <style name="Theme.Sigla" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="colorPrimary">@color/sg_brand</item>
        <item name="colorPrimaryVariant">@color/sg_brand</item>
        <item name="colorOnPrimary">@color/sg_on_brand</item>
        <item name="colorSecondary">@color/sg_brand</item>
        <item name="colorOnSecondary">@color/sg_on_brand</item>
        <item name="android:windowBackground">@color/sg_bg</item>
        <item name="android:statusBarColor">@color/sg_bg</item>
        <item name="android:navigationBarColor">@color/sg_bar_bg</item>
        <item name="android:windowLightStatusBar">false</item>
    </style>
</resources>
```
`Theme.Sigla.Immersive` is defined only in `values/` and inherits from whichever `Theme.Sigla` applies, then overrides every value that differs — so it looks the same in both modes.

In `app/src/main/AndroidManifest.xml`:
- On the `<activity android:name=".MainActivity" ...>` element, add `android:theme="@style/Theme.Sigla.Immersive"`.
- On `<activity android:name=".FullscreenVideoActivity" ...>`, change `android:theme="@style/Theme.Sigla"` to `android:theme="@style/Theme.Sigla.Immersive"`.

- [ ] **Step 8: Dark-mode default and user name**

In `app/src/main/kotlin/com/example/sigla/AppSettings.kt`:

In the companion object, after `private const val KEY_TRANSLATION_MODE = "translation_mode"`, add:
```kotlin
        private const val KEY_USER_NAME = "user_name"
        // Light is the default from the revamp on (spec §4). A stored value always
        // wins, so users who switched dark mode on keep it.
        private const val DEFAULT_DARK_MODE = false
```
Change the `isDarkMode` getter from `prefs.getBoolean(KEY_DARK_MODE, true)` to:
```kotlin
        get() = prefs.getBoolean(KEY_DARK_MODE, DEFAULT_DARK_MODE)
```
In `resetToDefault()`, change `.putBoolean(KEY_DARK_MODE, true)` to `.putBoolean(KEY_DARK_MODE, DEFAULT_DARK_MODE)`.

After the `isOnboardingDone` property, add:
```kotlin
    /**
     * Optional first name for the Home greeting, stored on this phone only.
     * Trimmed on write; blank is stored as null so "no name" has one meaning.
     */
    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(v) {
            val clean = v?.trim()?.takeIf { it.isNotEmpty() }
            prefs.edit().apply {
                if (clean == null) remove(KEY_USER_NAME) else putString(KEY_USER_NAME, clean)
            }.apply()
        }
```

- [ ] **Step 9: Build, test, and check the dark-mode default on a device**

Run: `./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL; 63 tests pass. The app now uses navy for Material defaults (switches, progress bars) and the translator/video keep their dark windows.

Device check (Review Focus 1), with the phone connected:
1. On the phone's current install, switch dark mode **on** in Settings (if it isn't already). Install the new debug APK over it. Open the app → it is still dark.
2. Only if a spare device or emulator is available: fresh install, open the app → it starts light. Never clear app data on the user's phone to test this (it wipes their history and favorites); if no spare device exists, note "fresh-install check skipped" in the report.
Record both results in the report.

- [ ] **Step 10: Commit**

```bash
git add app/src/main/res/values/colors_sigla.xml app/src/main/res/values-night/colors_sigla.xml app/src/main/res/values/dimens_sigla.xml app/src/main/res/values/styles_sigla.xml app/src/main/res/values/themes.xml app/src/main/res/values-night/themes.xml app/src/main/res/font/poppins_semibold.ttf app/src/main/res/drawable/bg_sg_search.xml app/src/main/res/drawable/bg_sg_circle_tint.xml app/src/main/kotlin/com/example/sigla/AppSettings.kt app/src/main/AndroidManifest.xml
git commit -m "feat(mobile): revamp design tokens, navy theme, light-by-default"
```

---

### Task 2: Icons

**Files:**
- Create: `app/src/main/res/drawable/ic_search_line.xml`, `ic_hand_line.xml`, `ic_chat_line.xml`

**Interfaces:**
- Produces: `@drawable/ic_search_line`, `@drawable/ic_hand_line` (centre button, hero card), `@drawable/ic_chat_line` (recent translation badge). Like the existing `ic_*_line` icons they are drawn white and coloured with `app:tint` / `imageTintList`.

- [ ] **Step 1: Search icon**

Create `app/src/main/res/drawable/ic_search_line.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M11,5a6,6 0,1 0,0.01 0z"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
    <path
        android:pathData="M15.5,15.5L20,20"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineCap="round"
        android:fillColor="#00000000" />
</vector>
```

- [ ] **Step 2: Hand icon**

Create `app/src/main/res/drawable/ic_hand_line.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <!-- Raised open hand: three fingers, thumb, palm. -->
    <path
        android:pathData="M9,11V5.2a1.2,1.2 0,0 1,2.4 0V10.5M11.4,10.5V4a1.2,1.2 0,0 1,2.4 0V10.5M13.8,10.8V5.6a1.2,1.2 0,0 1,2.4 0V13.5a5,5 0,0 1,-5 5H11a4.6,4.6 0,0 1,-3.6 -1.8L4.9,13.1a1.3,1.3 0,0 1,2 -1.6L9,13.8V11"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
</vector>
```

- [ ] **Step 3: Chat bubble icon**

Create `app/src/main/res/drawable/ic_chat_line.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M6,5H18a2,2 0,0 1,2 2V15a2,2 0,0 1,-2 2H11L7,20V17H6a2,2 0,0 1,-2 -2V7a2,2 0,0 1,2 -2z"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="1.7"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
</vector>
```

- [ ] **Step 4: Build**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL (a malformed `pathData` fails resource compilation here). Open each XML in Android Studio's preview if available and confirm it reads as a magnifier, a raised hand and a speech bubble; adjust `pathData` only if a shape is unreadable.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/res/drawable/ic_search_line.xml app/src/main/res/drawable/ic_hand_line.xml app/src/main/res/drawable/ic_chat_line.xml
git commit -m "feat(mobile): search, hand and chat outline icons"
```

---

### Task 3: Home logic (pure Kotlin, TDD)

**Files:**
- Create: `app/src/main/kotlin/com/example/sigla/HomeContent.kt`
- Create: `app/src/test/kotlin/com/example/sigla/HomeContentTest.kt`

**Interfaces:**
- Consumes: `TranslationEntry(word: String, confidence: Int, gestureType: String, timestamp: Long)` (TranslationHistoryManager.kt), `WordBankWord(id: Int, label: String, …, category: String = "additional words", …)` (ApiService.kt).
- Produces:
  - `data class Greeting(val title: String, val subtitle: String?)`
  - `internal fun homeGreeting(hour: Int, name: String?): Greeting`
  - `data class HomeStats(val today: Int, val saved: Int, val favorites: Int)`
  - `internal fun homeStats(entries: List<TranslationEntry>, favoritesCount: Int, nowMillis: Long, timeZone: TimeZone): HomeStats`
  - `internal fun isSameLocalDay(aMillis: Long, bMillis: Long, timeZone: TimeZone): Boolean`
  - `data class HomeCategory(val name: String, val wordCount: Int)`
  - `internal fun homeCategories(words: List<WordBankWord>, categoryNames: List<String>, limit: Int = 4): List<HomeCategory>`
  - `internal fun recentEntries(entries: List<TranslationEntry>, limit: Int = 3): List<TranslationEntry>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/test/kotlin/com/example/sigla/HomeContentTest.kt`:
```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class HomeContentTest {

    private val manila: TimeZone = TimeZone.getTimeZone("Asia/Manila")

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance(manila).apply {
            clear()
            set(year, month - 1, day, hour, minute)
        }.timeInMillis

    private fun entry(ts: Long, word: String = "HELLO") =
        TranslationEntry(word = word, confidence = 90, gestureType = "motion", timestamp = ts)

    private fun word(id: Int, category: String) = WordBankWord(id = id, label = "W$id", category = category)

    // ── Greeting ──────────────────────────────────────────────────────────────

    @Test
    fun timeOfDayBoundaries() {
        assertEquals("Good morning", homeGreeting(0, null).title)
        assertEquals("Good morning", homeGreeting(11, null).title)
        assertEquals("Good afternoon", homeGreeting(12, null).title)
        assertEquals("Good afternoon", homeGreeting(17, null).title)
        assertEquals("Good evening", homeGreeting(18, null).title)
        assertEquals("Good evening", homeGreeting(23, null).title)
    }

    @Test
    fun nameMovesTimeLineToSubtitle() {
        val g = homeGreeting(9, "  Maria ")
        assertEquals("Hi Maria!", g.title)
        assertEquals("Good morning", g.subtitle)
    }

    @Test
    fun noNameMeansNoSubtitle() {
        val g = homeGreeting(20, null)
        assertEquals("Good evening", g.title)
        assertNull(g.subtitle)
    }

    // Review Focus 4.
    @Test
    fun blankNameTreatedAsNoName() {
        val g = homeGreeting(14, "   ")
        assertEquals("Good afternoon", g.title)
        assertNull(g.subtitle)
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    // Review Focus 3.
    @Test
    fun todayCountsByLocalCalendarDate() {
        val now = at(2026, 9, 28, 10, 0)
        val entries = listOf(
            entry(at(2026, 9, 28, 9, 59)),   // today
            entry(at(2026, 9, 28, 0, 5)),    // today, just after midnight
            entry(at(2026, 9, 27, 23, 59)),  // yesterday, within 24h
            entry(at(2025, 9, 28, 10, 0)),   // same date, last year
        )
        val stats = homeStats(entries, favoritesCount = 9, nowMillis = now, timeZone = manila)
        assertEquals(HomeStats(today = 2, saved = 4, favorites = 9), stats)
    }

    @Test
    fun statsForEmptyHistory() {
        assertEquals(HomeStats(0, 0, 0), homeStats(emptyList(), 0, at(2026, 1, 1, 8, 0), manila))
    }

    @Test
    fun sameLocalDayUsesTheGivenTimeZone() {
        val a = at(2026, 9, 28, 23, 30)
        val b = at(2026, 9, 29, 0, 30)
        assertFalse(isSameLocalDay(a, b, manila))
        assertTrue(isSameLocalDay(a, at(2026, 9, 28, 0, 0), manila))
    }

    // ── Categories ────────────────────────────────────────────────────────────

    @Test
    fun categoriesOrderedByCountThenNameAndLimited() {
        val words = listOf(
            word(1, "Greetings"), word(2, "greetings"), word(3, "GREETINGS"),
            word(4, "Family"),
            word(5, "Questions"), word(6, "Questions"),
            word(7, "Days"), word(8, "days"),
        )
        val names = listOf("Family", "Questions", "Greetings", "Days", "Colors")
        val result = homeCategories(words, names, limit = 3)
        assertEquals(
            listOf(HomeCategory("Greetings", 3), HomeCategory("Days", 2), HomeCategory("Questions", 2)),
            result,
        )
    }

    @Test
    fun categoriesWithNoWordsAreExcluded() {
        val result = homeCategories(listOf(word(1, "Family")), listOf("Family", "Colors"))
        assertEquals(listOf(HomeCategory("Family", 1)), result)
    }

    @Test
    fun categoriesFallBackToWordCategoriesWhenNamesMissing() {
        val words = listOf(word(1, "Days"), word(2, "Family"), word(3, "family"))
        assertEquals(
            listOf(HomeCategory("Family", 2), HomeCategory("Days", 1)),
            homeCategories(words, emptyList()),
        )
    }

    // Review Focus 2.
    @Test
    fun homeCategoriesEmptyWhenNoWords() {
        assertTrue(homeCategories(emptyList(), listOf("Family")).isEmpty())
        assertTrue(homeCategories(emptyList(), emptyList()).isEmpty())
    }

    // ── Recent ────────────────────────────────────────────────────────────────

    @Test
    fun recentTakesNewestThree() {
        val all = (5 downTo 1).map { entry(it.toLong(), "W$it") } // newest first, as stored
        assertEquals(listOf("W5", "W4", "W3"), recentEntries(all).map { it.word })
        assertEquals(1, recentEntries(all.take(1)).size)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.HomeContentTest`
Expected: compilation FAILURE — unresolved `homeGreeting`, `homeStats`, `HomeStats`, `isSameLocalDay`, `homeCategories`, `HomeCategory`, `recentEntries`.

- [ ] **Step 3: Implement**

Create `app/src/main/kotlin/com/example/sigla/HomeContent.kt`:
```kotlin
package com.example.sigla

import java.util.Calendar
import java.util.TimeZone

// Pure logic behind the Home screen (spec §6–7). No Android types, so every rule
// here is unit-tested in HomeContentTest.

data class Greeting(val title: String, val subtitle: String?)

private fun timeOfDayLine(hour: Int): String = when {
    hour < 12 -> "Good morning"
    hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

/** "Hi Maria!" over "Good morning", or just "Good morning" when there is no name. */
internal fun homeGreeting(hour: Int, name: String?): Greeting {
    val timeLine = timeOfDayLine(hour)
    val cleanName = name?.trim()?.takeIf { it.isNotEmpty() }
    return if (cleanName == null) Greeting(timeLine, null) else Greeting("Hi $cleanName!", timeLine)
}

data class HomeStats(val today: Int, val saved: Int, val favorites: Int)

/** True when both instants fall on the same calendar date in [timeZone]. */
internal fun isSameLocalDay(aMillis: Long, bMillis: Long, timeZone: TimeZone): Boolean {
    val a = Calendar.getInstance(timeZone).apply { timeInMillis = aMillis }
    val b = Calendar.getInstance(timeZone).apply { timeInMillis = bMillis }
    return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) &&
        a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
}

/**
 * Today = entries on today's local date. Saved = every stored entry; history is
 * capped (TranslationHistoryManager.MAX_ENTRIES), which is why the label is
 * "Saved" rather than "Total".
 */
internal fun homeStats(
    entries: List<TranslationEntry>,
    favoritesCount: Int,
    nowMillis: Long,
    timeZone: TimeZone,
): HomeStats {
    val today = entries.count { isSameLocalDay(it.timestamp, nowMillis, timeZone) }
    return HomeStats(today = today, saved = entries.size, favorites = favoritesCount)
}

data class HomeCategory(val name: String, val wordCount: Int)

/**
 * Categories for the Home grid: those with at least one word, most words first,
 * ties by name, at most [limit]. Counts come from the word bank itself (case-
 * insensitive, like WordBankActivity), not from CategoryItem.word_count, so they
 * match what the word lists actually show. When the category list is not cached,
 * the categories named on the words are used instead.
 */
internal fun homeCategories(
    words: List<WordBankWord>,
    categoryNames: List<String>,
    limit: Int = 4,
): List<HomeCategory> {
    val counts = HashMap<String, Int>()
    val firstSpelling = LinkedHashMap<String, String>()
    for (w in words) {
        val key = w.category.lowercase()
        counts[key] = (counts[key] ?: 0) + 1
        if (key !in firstSpelling) firstSpelling[key] = w.category
    }
    val names = if (categoryNames.isNotEmpty()) {
        categoryNames.distinctBy { it.lowercase() }
    } else {
        firstSpelling.values.toList()
    }
    return names
        .map { HomeCategory(it, counts[it.lowercase()] ?: 0) }
        .filter { it.wordCount > 0 }
        .sortedWith(compareByDescending<HomeCategory> { it.wordCount }.thenBy { it.name.lowercase() })
        .take(limit)
}

/** History is stored newest-first, so the first entries are the most recent. */
internal fun recentEntries(entries: List<TranslationEntry>, limit: Int = 3): List<TranslationEntry> =
    entries.take(limit)
```

- [ ] **Step 4: Run to verify it passes**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.HomeContentTest`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/kotlin/com/example/sigla/HomeContent.kt app/src/test/kotlin/com/example/sigla/HomeContentTest.kt
git commit -m "feat(mobile): Home greeting, stats and category logic"
```

---

### Task 4: Bottom bar component

**Files:**
- Create: `app/src/main/res/layout/view_bottom_nav.xml`
- Create: `app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt`
- Create: `app/src/test/kotlin/com/example/sigla/BottomNavHelperTest.kt`

**Interfaces:**
- Consumes: styles/colours from Task 1; `ic_hand_line` from Task 2; existing `ic_house_line`, `ic_book_line`, `ic_history_line`, `ic_settings_line`.
- Produces:
  - Layout `view_bottom_nav.xml`, a `<merge>` meant to be `<include>`d as the **last child of a `CoordinatorLayout`**; view ids `bottomAppBar`, `tabHome`, `tabHomeIcon`, `tabHomeLabel`, `tabWordBank`, `tabWordBankIcon`, `tabWordBankLabel`, `tabHistory`, `tabHistoryIcon`, `tabHistoryLabel`, `tabSettings`, `tabSettingsIcon`, `tabSettingsLabel`, `fabTranslate`.
  - `enum class Tab { HOME, WORD_BANK, HISTORY, SETTINGS }`
  - `object BottomNavHelper` with `fun setup(activity: Activity, current: Tab)`, `fun open(activity: Activity, tab: Tab)`, `fun openWordBankSearch(activity: Activity)`, `fun openTranslator(activity: Activity)`, `internal fun activityFor(tab: Tab): Class<out Activity>`.
  - `BottomNavHelper` needs `HomeActivity` and `WordBankActivity.EXTRA_FOCUS_SEARCH` to exist. Step 3 creates a one-line `HomeActivity` placeholder and the constant so this task builds on its own; Task 5 replaces the placeholder and Task 6 uses the constant.

- [ ] **Step 1: Write the failing test**

Create `app/src/test/kotlin/com/example/sigla/BottomNavHelperTest.kt`:
```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class BottomNavHelperTest {
    @Test
    fun everyTabOpensItsOwnScreen() {
        assertEquals(HomeActivity::class.java, BottomNavHelper.activityFor(Tab.HOME))
        assertEquals(WordBankActivity::class.java, BottomNavHelper.activityFor(Tab.WORD_BANK))
        assertEquals(TranslationHistoryActivity::class.java, BottomNavHelper.activityFor(Tab.HISTORY))
        assertEquals(SettingsActivity::class.java, BottomNavHelper.activityFor(Tab.SETTINGS))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.BottomNavHelperTest`
Expected: compilation FAILURE — unresolved `HomeActivity`, `BottomNavHelper`, `Tab`.

- [ ] **Step 3: Stubs the helper needs**

Create `app/src/main/kotlin/com/example/sigla/HomeActivity.kt` (replaced in Task 5):
```kotlin
package com.example.sigla

import androidx.appcompat.app.AppCompatActivity

/** Placeholder so BottomNavHelper compiles; the real screen arrives in Task 5. */
class HomeActivity : AppCompatActivity()
```
In `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt`, add this constant inside the existing `companion object` (around line 70):
```kotlin
        /** Set by Home's search bar: focus the search field and open the keyboard. */
        const val EXTRA_FOCUS_SEARCH = "extra_focus_search"
```

- [ ] **Step 4: Bottom bar layout**

Create `app/src/main/res/layout/view_bottom_nav.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Shared bottom bar (spec §3). Include as the LAST child of a CoordinatorLayout;
     the centre button anchors to the bar and sits in its cradle. Wired by
     BottomNavHelper.setup(). -->
<merge xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    tools:parentTag="androidx.coordinatorlayout.widget.CoordinatorLayout">

    <com.google.android.material.bottomappbar.BottomAppBar
        android:id="@+id/bottomAppBar"
        style="@style/Widget.Sigla.BottomAppBar"
        android:layout_width="match_parent"
        android:layout_height="@dimen/sg_bottom_bar_height"
        android:layout_gravity="bottom">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:orientation="horizontal">

            <LinearLayout android:id="@+id/tabHome" style="@style/Widget.Sigla.Tab">
                <ImageView android:id="@+id/tabHomeIcon" style="@style/Widget.Sigla.TabIcon"
                    android:src="@drawable/ic_house_line" />
                <TextView android:id="@+id/tabHomeLabel" style="@style/Widget.Sigla.TabLabel"
                    android:text="Home" />
            </LinearLayout>

            <LinearLayout android:id="@+id/tabWordBank" style="@style/Widget.Sigla.Tab">
                <ImageView android:id="@+id/tabWordBankIcon" style="@style/Widget.Sigla.TabIcon"
                    android:src="@drawable/ic_book_line" />
                <TextView android:id="@+id/tabWordBankLabel" style="@style/Widget.Sigla.TabLabel"
                    android:text="Word Bank" />
            </LinearLayout>

            <!-- Room for the centre button -->
            <Space
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1" />

            <LinearLayout android:id="@+id/tabHistory" style="@style/Widget.Sigla.Tab">
                <ImageView android:id="@+id/tabHistoryIcon" style="@style/Widget.Sigla.TabIcon"
                    android:src="@drawable/ic_history_line" />
                <TextView android:id="@+id/tabHistoryLabel" style="@style/Widget.Sigla.TabLabel"
                    android:text="History" />
            </LinearLayout>

            <LinearLayout android:id="@+id/tabSettings" style="@style/Widget.Sigla.Tab">
                <ImageView android:id="@+id/tabSettingsIcon" style="@style/Widget.Sigla.TabIcon"
                    android:src="@drawable/ic_settings_line" />
                <TextView android:id="@+id/tabSettingsLabel" style="@style/Widget.Sigla.TabLabel"
                    android:text="Settings" />
            </LinearLayout>
        </LinearLayout>
    </com.google.android.material.bottomappbar.BottomAppBar>

    <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:id="@+id/fabTranslate"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:contentDescription="Translate"
        app:srcCompat="@drawable/ic_hand_line"
        app:tint="@color/sg_on_brand"
        app:backgroundTint="@color/sg_brand"
        app:fabCustomSize="60dp"
        app:maxImageSize="28dp"
        app:layout_anchor="@id/bottomAppBar" />
</merge>
```

- [ ] **Step 5: BottomNavHelper**

Create `app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt`:
```kotlin
package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat

enum class Tab { HOME, WORD_BANK, HISTORY, SETTINGS }

/**
 * Wires view_bottom_nav.xml on a tab screen (spec §3).
 *
 * Tabs are separate Activities. Switching reorders the existing instance to the
 * front with no animation, so a tab keeps its scroll position and state and the
 * switch feels like a tab change. The centre button opens the translator on top.
 */
object BottomNavHelper {

    private class TabViews(val tab: Tab, val root: Int, val icon: Int, val label: Int)

    private val TABS = listOf(
        TabViews(Tab.HOME, R.id.tabHome, R.id.tabHomeIcon, R.id.tabHomeLabel),
        TabViews(Tab.WORD_BANK, R.id.tabWordBank, R.id.tabWordBankIcon, R.id.tabWordBankLabel),
        TabViews(Tab.HISTORY, R.id.tabHistory, R.id.tabHistoryIcon, R.id.tabHistoryLabel),
        TabViews(Tab.SETTINGS, R.id.tabSettings, R.id.tabSettingsIcon, R.id.tabSettingsLabel),
    )

    internal fun activityFor(tab: Tab): Class<out Activity> = when (tab) {
        Tab.HOME -> HomeActivity::class.java
        Tab.WORD_BANK -> WordBankActivity::class.java
        Tab.HISTORY -> TranslationHistoryActivity::class.java
        Tab.SETTINGS -> SettingsActivity::class.java
    }

    fun setup(activity: Activity, current: Tab) {
        val on = ContextCompat.getColor(activity, R.color.sg_brand_text)
        val off = ContextCompat.getColor(activity, R.color.sg_text_secondary)
        val semibold = ResourcesCompat.getFont(activity, R.font.poppins_semibold)
        val regular = ResourcesCompat.getFont(activity, R.font.poppins_regular)
        for (t in TABS) {
            val selected = t.tab == current
            activity.findViewById<ImageView>(t.icon).imageTintList =
                ColorStateList.valueOf(if (selected) on else off)
            activity.findViewById<TextView>(t.label).apply {
                setTextColor(if (selected) on else off)
                typeface = if (selected) semibold else regular
            }
            activity.findViewById<View>(t.root).apply {
                isSelected = selected
                setOnClickListener { open(activity, t.tab) }
            }
        }
        activity.findViewById<View>(R.id.fabTranslate).setOnClickListener { openTranslator(activity) }
    }

    fun open(activity: Activity, tab: Tab) {
        val target = activityFor(tab)
        if (activity.javaClass == target) return
        activity.startActivity(Intent(activity, target).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
    }

    fun openWordBankSearch(activity: Activity) {
        activity.startActivity(
            Intent(activity, WordBankActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra(WordBankActivity.EXTRA_FOCUS_SEARCH, true)
        )
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
    }

    fun openTranslator(activity: Activity) {
        activity.startActivity(Intent(activity, MainActivity::class.java))
    }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.BottomNavHelperTest`
Expected: PASS. Then `./gradlew assembleDebug` → BUILD SUCCESSFUL (the layout isn't included anywhere yet).

- [ ] **Step 7: Commit**

```bash
git add app/src/main/res/layout/view_bottom_nav.xml app/src/main/kotlin/com/example/sigla/BottomNavHelper.kt app/src/test/kotlin/com/example/sigla/BottomNavHelperTest.kt app/src/main/kotlin/com/example/sigla/HomeActivity.kt app/src/main/kotlin/com/example/sigla/WordBankActivity.kt
git commit -m "feat(mobile): shared bottom bar with centre translate button"
```

---

### Task 5: Home screen

**Files:**
- Create: `app/src/main/res/layout/activity_home.xml`, `item_home_category.xml`, `item_home_recent.xml`
- Modify: `app/src/main/kotlin/com/example/sigla/HomeActivity.kt` (replace the stub), `app/src/main/res/values/strings.xml`, `app/src/main/AndroidManifest.xml`, `app/src/main/kotlin/com/example/sigla/OnboardingActivity.kt`

**Interfaces:**
- Consumes: everything from Tasks 1–4; `TranslationHistoryManager.getInstance(ctx).getAll(): List<TranslationEntry>` (newest first) and its companion `formatDate(ts: Long): String` / `formatTime(ts: Long): String`; `FavoritesManager.getInstance(ctx).getAll(): Set<Int>`; `suspend ModelUpdateManager.loadCachedWordBank(ctx): List<WordBankWord>?`; `suspend ModelUpdateManager.loadCachedCategories(ctx): List<CategoryItem>?` (`CategoryItem.name`); `String.toTitleCase()` (StringExt.kt); `CategoryWordListActivity.EXTRA_CATEGORY_NAME`.
- Produces: `HomeActivity` (launcher). Onboarding now finishes into Home.

- [ ] **Step 1: Strings**

In `app/src/main/res/values/strings.xml`, add inside `<resources>`:
```xml
    <plurals name="home_word_count">
        <item quantity="one">%d word</item>
        <item quantity="other">%d words</item>
    </plurals>
```

- [ ] **Step 2: Category card layout**

Create `app/src/main/res/layout/item_home_category.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<com.google.android.material.card.MaterialCardView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    style="@style/Widget.Sigla.Card.Tint"
    android:layout_width="0dp"
    android:layout_height="wrap_content"
    android:clickable="true"
    android:focusable="true">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:padding="@dimen/sg_space_12">

        <ImageView
            android:id="@+id/ivCategoryIcon"
            android:layout_width="24dp"
            android:layout_height="24dp"
            android:importantForAccessibility="no"
            android:src="@drawable/ic_tag_line"
            android:tint="@color/sg_brand_text" />

        <TextView
            android:id="@+id/tvCategoryName"
            style="@style/Sigla.Text.BodyStrong"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="@dimen/sg_space_8"
            android:ellipsize="end"
            android:maxLines="1"
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

- [ ] **Step 3: Recent row layout**

Create `app/src/main/res/layout/item_home_recent.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:minHeight="56dp"
    android:background="?attr/selectableItemBackground"
    android:clickable="true"
    android:focusable="true"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:paddingTop="@dimen/sg_space_8"
    android:paddingBottom="@dimen/sg_space_8">

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
            android:id="@+id/tvRecentWord"
            style="@style/Sigla.Text.BodyStrong"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            tools:text="Good Morning" />
        <TextView
            android:id="@+id/tvRecentMeta"
            style="@style/Sigla.Text.Caption"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            tools:text="Today · 9:41 AM" />
    </LinearLayout>
</LinearLayout>
```

- [ ] **Step 4: Home layout**

Create `app/src/main/res/layout/activity_home.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Home dashboard (spec §5; mockup home-v1.html). Top to bottom: greeting, search,
     "Start translating" hero, stats, categories, recent translations. -->
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sg_bg">

    <androidx.core.widget.NestedScrollView
        android:id="@+id/homeScroll"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:clipToPadding="false"
        android:paddingBottom="@dimen/sg_bottom_bar_clearance">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingStart="@dimen/sg_screen_padding"
            android:paddingTop="@dimen/sg_space_24"
            android:paddingEnd="@dimen/sg_screen_padding">

            <!-- Greeting -->
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
                        android:id="@+id/tvGreetingTitle"
                        style="@style/Sigla.Text.Title"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:ellipsize="end"
                        android:maxLines="1"
                        tools:text="Hi Maria!" />
                    <TextView
                        android:id="@+id/tvGreetingSubtitle"
                        style="@style/Sigla.Text.Secondary"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        tools:text="Good morning" />
                </LinearLayout>

                <TextView
                    android:id="@+id/tvAvatar"
                    style="@style/Sigla.Text.BodyStrong"
                    android:layout_width="@dimen/sg_badge_size"
                    android:layout_height="@dimen/sg_badge_size"
                    android:layout_marginStart="@dimen/sg_space_12"
                    android:background="@drawable/bg_sg_circle_tint"
                    android:gravity="center"
                    android:importantForAccessibility="no"
                    android:textColor="@color/sg_brand_text"
                    android:visibility="gone"
                    tools:text="M"
                    tools:visibility="visible" />
            </LinearLayout>

            <!-- Search → Word Bank -->
            <LinearLayout
                android:id="@+id/homeSearch"
                android:layout_width="match_parent"
                android:layout_height="@dimen/sg_search_height"
                android:layout_marginTop="@dimen/sg_space_16"
                android:background="@drawable/bg_sg_search"
                android:clickable="true"
                android:contentDescription="Search FSL signs"
                android:focusable="true"
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
                <TextView
                    style="@style/Sigla.Text.Secondary"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="@dimen/sg_space_12"
                    android:importantForAccessibility="no"
                    android:text="Search FSL signs" />
            </LinearLayout>

            <!-- Hero -->
            <com.google.android.material.card.MaterialCardView
                android:id="@+id/cardHero"
                style="@style/Widget.Sigla.Card.Outlined"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_16"
                android:clickable="true"
                android:focusable="true">
                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:gravity="center_vertical"
                    android:orientation="horizontal"
                    android:padding="@dimen/sg_space_16">
                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:orientation="vertical">
                        <TextView
                            style="@style/Sigla.Text.CardTitle"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="Start translating" />
                        <TextView
                            style="@style/Sigla.Text.Secondary"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="@dimen/sg_space_4"
                            android:text="Tap, sign one word, and SigLa reads it for you." />
                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnHeroStart"
                            style="@style/Widget.Sigla.Button"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="@dimen/sg_space_12"
                            android:text="Open camera" />
                    </LinearLayout>
                    <FrameLayout
                        android:layout_width="88dp"
                        android:layout_height="88dp"
                        android:layout_marginStart="@dimen/sg_space_8"
                        android:background="@drawable/bg_sg_circle_tint">
                        <ImageView
                            android:layout_width="44dp"
                            android:layout_height="44dp"
                            android:layout_gravity="center"
                            android:importantForAccessibility="no"
                            android:src="@drawable/ic_hand_line"
                            android:tint="@color/sg_brand_text" />
                    </FrameLayout>
                </LinearLayout>
            </com.google.android.material.card.MaterialCardView>

            <!-- Stats -->
            <com.google.android.material.card.MaterialCardView
                style="@style/Widget.Sigla.Card.Brand"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_16">
                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:orientation="horizontal"
                    android:paddingTop="@dimen/sg_space_16"
                    android:paddingBottom="@dimen/sg_space_16">
                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">
                        <TextView android:id="@+id/tvStatToday" style="@style/Sigla.Text.StatValue"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            tools:text="12" />
                        <TextView style="@style/Sigla.Text.StatLabel"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            android:text="Today" />
                    </LinearLayout>
                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">
                        <TextView android:id="@+id/tvStatSaved" style="@style/Sigla.Text.StatValue"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            tools:text="148" />
                        <TextView style="@style/Sigla.Text.StatLabel"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            android:text="Saved" />
                    </LinearLayout>
                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">
                        <TextView android:id="@+id/tvStatFavorites" style="@style/Sigla.Text.StatValue"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            tools:text="9" />
                        <TextView style="@style/Sigla.Text.StatLabel"
                            android:layout_width="wrap_content" android:layout_height="wrap_content"
                            android:text="Favorites" />
                    </LinearLayout>
                </LinearLayout>
            </com.google.android.material.card.MaterialCardView>

            <!-- Categories -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_20"
                android:gravity="center_vertical"
                android:orientation="horizontal">
                <TextView
                    style="@style/Sigla.Text.Section"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Categories" />
                <TextView
                    android:id="@+id/tvCategoriesViewAll"
                    style="@style/Sigla.Text.Link"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:minHeight="@dimen/sg_touch_min"
                    android:gravity="center_vertical"
                    android:paddingStart="@dimen/sg_space_8"
                    android:text="View all" />
            </LinearLayout>

            <!-- 6dp negative side margins offset the 6dp margin on each card so
                 the grid's outer edges line up with the screen padding. -->
            <GridLayout
                android:id="@+id/gridCategories"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginStart="-6dp"
                android:layout_marginEnd="-6dp"
                android:columnCount="2"
                android:useDefaultMargins="false" />

            <TextView
                android:id="@+id/tvCategoriesEmpty"
                style="@style/Sigla.Text.Secondary"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="Connect to the internet once to download the word bank."
                android:visibility="gone" />

            <!-- Recent translations -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="@dimen/sg_space_20"
                android:gravity="center_vertical"
                android:orientation="horizontal">
                <TextView
                    style="@style/Sigla.Text.Section"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Recent translations" />
                <TextView
                    android:id="@+id/tvRecentViewAll"
                    style="@style/Sigla.Text.Link"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:minHeight="@dimen/sg_touch_min"
                    android:gravity="center_vertical"
                    android:paddingStart="@dimen/sg_space_8"
                    android:text="View all" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/listRecent"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical" />

            <LinearLayout
                android:id="@+id/recentEmpty"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:visibility="gone">
                <TextView
                    style="@style/Sigla.Text.Secondary"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Your translations will appear here." />
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnRecentStart"
                    style="@style/Widget.Sigla.Button"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="@dimen/sg_space_12"
                    android:text="Start translating" />
            </LinearLayout>
        </LinearLayout>
    </androidx.core.widget.NestedScrollView>

    <include layout="@layout/view_bottom_nav" />
</androidx.coordinatorlayout.widget.CoordinatorLayout>
```

- [ ] **Step 5: HomeActivity**

Replace the whole content of `app/src/main/kotlin/com/example/sigla/HomeActivity.kt`:
```kotlin
package com.example.sigla

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.widget.GridLayout
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityHomeBinding
import com.example.sigla.databinding.ItemHomeCategoryBinding
import com.example.sigla.databinding.ItemHomeRecentBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.TimeZone

/**
 * Launch screen (spec §3, §5). Reads only data already on the phone — history,
 * favorites and the cached word bank — so it works offline and never waits on
 * the network. Recomputed on every onResume so a translation made a moment ago
 * shows up immediately.
 */
class HomeActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHomeBinding
    private lateinit var appSettings: AppSettings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appSettings = AppSettings.getInstance(this)

        // First launch (or "Replay tutorial"): onboarding comes first and finishes
        // back into Home. Moved here from MainActivity, which is no longer the launcher.
        if (!appSettings.isOnboardingDone) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)

        BottomNavHelper.setup(this, Tab.HOME)
        binding.homeSearch.setOnClickListener { BottomNavHelper.openWordBankSearch(this) }
        binding.cardHero.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.btnHeroStart.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.btnRecentStart.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.tvCategoriesViewAll.setOnClickListener { BottomNavHelper.open(this, Tab.WORD_BANK) }
        binding.tvRecentViewAll.setOnClickListener { BottomNavHelper.open(this, Tab.HISTORY) }

        // Home is the root: back leaves the app. finishAffinity() also closes the
        // other tab screens kept alive behind it by the bottom bar.
        onBackPressedDispatcher.addCallback(this) { finishAffinity() }
    }

    override fun onResume() {
        super.onResume()
        if (::binding.isInitialized) refresh()
    }

    private fun refresh() {
        renderGreeting()

        val entries = TranslationHistoryManager.getInstance(this).getAll()
        val stats = homeStats(
            entries = entries,
            favoritesCount = FavoritesManager.getInstance(this).getAll().size,
            nowMillis = System.currentTimeMillis(),
            timeZone = TimeZone.getDefault(),
        )
        binding.tvStatToday.text = stats.today.toString()
        binding.tvStatSaved.text = stats.saved.toString()
        binding.tvStatFavorites.text = stats.favorites.toString()

        renderRecent(recentEntries(entries))

        lifecycleScope.launch {
            val words = withContext(Dispatchers.IO) {
                ModelUpdateManager.loadCachedWordBank(this@HomeActivity)
            }.orEmpty()
            val names = withContext(Dispatchers.IO) {
                ModelUpdateManager.loadCachedCategories(this@HomeActivity)
            }.orEmpty().map { it.name }
            renderCategories(homeCategories(words, names))
        }
    }

    private fun renderGreeting() {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val greeting = homeGreeting(hour, appSettings.userName)
        binding.tvGreetingTitle.text = greeting.title
        binding.tvGreetingSubtitle.text = greeting.subtitle.orEmpty()
        binding.tvGreetingSubtitle.isVisible = greeting.subtitle != null

        val name = appSettings.userName?.trim()?.takeIf { it.isNotEmpty() }
        binding.tvAvatar.isVisible = name != null
        binding.tvAvatar.text = name?.take(1)?.uppercase().orEmpty()
    }

    private fun renderCategories(categories: List<HomeCategory>) {
        val grid = binding.gridCategories
        grid.removeAllViews()
        grid.isVisible = categories.isNotEmpty()
        binding.tvCategoriesEmpty.isVisible = categories.isEmpty()

        val brand = ContextCompat.getColor(this, R.color.sg_brand)
        val onBrand = ContextCompat.getColor(this, R.color.sg_on_brand)
        val onBrandSecondary = ContextCompat.getColor(this, R.color.sg_on_brand_secondary)
        val gap = resources.getDimensionPixelSize(R.dimen.sg_space_12) / 2

        categories.forEachIndexed { index, category ->
            val item = ItemHomeCategoryBinding.inflate(layoutInflater, grid, false)
            item.tvCategoryName.text = category.name.toTitleCase()
            item.tvCategoryCount.text = resources.getQuantityString(
                R.plurals.home_word_count, category.wordCount, category.wordCount
            )
            // The first card is the navy highlight, like the reference.
            if (index == 0) {
                item.root.setCardBackgroundColor(brand)
                item.tvCategoryName.setTextColor(onBrand)
                item.tvCategoryCount.setTextColor(onBrandSecondary)
                item.ivCategoryIcon.imageTintList = ColorStateList.valueOf(onBrand)
            }
            item.root.setOnClickListener {
                startActivity(
                    Intent(this, CategoryWordListActivity::class.java)
                        .putExtra(CategoryWordListActivity.EXTRA_CATEGORY_NAME, category.name)
                )
            }
            val params = GridLayout.LayoutParams(
                GridLayout.spec(GridLayout.UNDEFINED),
                GridLayout.spec(GridLayout.UNDEFINED, 1f),
            ).apply {
                width = 0
                setMargins(gap, gap, gap, gap)
            }
            grid.addView(item.root, params)
        }
    }

    private fun renderRecent(entries: List<TranslationEntry>) {
        binding.listRecent.removeAllViews()
        binding.recentEmpty.isVisible = entries.isEmpty()
        val now = System.currentTimeMillis()
        val zone = TimeZone.getDefault()
        for (entry in entries) {
            val row = ItemHomeRecentBinding.inflate(layoutInflater, binding.listRecent, false)
            row.tvRecentWord.text = entry.word.toTitleCase()
            val day = if (isSameLocalDay(entry.timestamp, now, zone)) "Today"
                      else TranslationHistoryManager.formatDate(entry.timestamp)
            row.tvRecentMeta.text = "$day · ${TranslationHistoryManager.formatTime(entry.timestamp)}"
            row.root.setOnClickListener { BottomNavHelper.open(this, Tab.HISTORY) }
            binding.listRecent.addView(row.root)
        }
    }
}
```
If `TranslationHistoryManager.formatDate`/`formatTime` are not callable as `TranslationHistoryManager.formatDate(...)`, check where they are declared (they are in its `companion object` at the time of writing) and call them the same way `TranslationHistoryActivity` does.

- [ ] **Step 6: Make Home the launcher**

In `app/src/main/AndroidManifest.xml`:
1. Move the `<intent-filter>` block (MAIN + LAUNCHER) out of the `.MainActivity` element, and set `.MainActivity`'s `android:exported="false"`.
2. Add, directly above the `.MainActivity` element:
```xml
        <activity
            android:name=".HomeActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
```

In `app/src/main/kotlin/com/example/sigla/OnboardingActivity.kt`, in `completeOnboarding()`, change `Intent(this, MainActivity::class.java)` to `Intent(this, HomeActivity::class.java)`.

- [ ] **Step 7: Build and test**

Run: `./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL; all tests pass (63 + 12 + 1 = 76).

- [ ] **Step 8: Commit**

```bash
git add app/src/main/res/layout/activity_home.xml app/src/main/res/layout/item_home_category.xml app/src/main/res/layout/item_home_recent.xml app/src/main/kotlin/com/example/sigla/HomeActivity.kt app/src/main/res/values/strings.xml app/src/main/AndroidManifest.xml app/src/main/kotlin/com/example/sigla/OnboardingActivity.kt
git commit -m "feat(mobile): Home dashboard as the launch screen"
```

---

### Task 6: Bottom bar on Word Bank, History and Settings

**Files:**
- Modify: `app/src/main/res/layout/activity_word_bank.xml`, `activity_translation_history.xml`, `activity_settings.xml`
- Modify: `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt`, `TranslationHistoryActivity.kt`, `SettingsActivity.kt`

**Interfaces:**
- Consumes: `view_bottom_nav.xml`, `BottomNavHelper`, `Tab` (Task 4); `WordBankActivity.EXTRA_FOCUS_SEARCH` (added in Task 4).
- Produces: the three screens without drawers; `NavigationHelper` and `nav_sidebar.xml` are no longer referenced by them (deleted in Task 7).

The three layouts share one shape: a `DrawerLayout` (id `drawerLayout`) wrapping a `CoordinatorLayout` (the screen content), with `<include layout="@layout/nav_sidebar" />` after it. Steps 1–3 apply the same edit to each.

- [ ] **Step 1: Layout root → CoordinatorLayout (all three layouts)**

In each of `activity_word_bank.xml`, `activity_translation_history.xml`, `activity_settings.xml`:

(a) Replace the opening `<androidx.drawerlayout.widget.DrawerLayout …>` tag **and** the `<androidx.coordinatorlayout.widget.CoordinatorLayout …>` opening tag that follows it (ignoring blank lines and comments between them) with this single opening tag:
```xml
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sig_page_bg">
```
If the old `DrawerLayout` tag declared `xmlns:tools`, keep that declaration on the new tag.

(b) At the end of the file, replace
```xml
    </androidx.coordinatorlayout.widget.CoordinatorLayout>

    <include layout="@layout/nav_sidebar" />

</androidx.drawerlayout.widget.DrawerLayout>
```
(including any comment between them) with:
```xml
    <include layout="@layout/view_bottom_nav" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
```

(c) Update the file's header comment: replace the line `- Retractable sidebar (no back button — sidebar matches activity_main.xml pattern)` with `- Bottom bar navigation (view_bottom_nav.xml)`.

- [ ] **Step 2: Remove the hamburger button (all three layouts)**

In each of the three layouts, delete the whole `<com.google.android.material.button.MaterialButton android:id="@+id/btnSidebar" … />` element and the `<!-- Sidebar 3-line hamburger button -->` comment above it. The title block next to it stays; its `layout_marginStart` can stay as it is (the header is restyled in Plan 2).

- [ ] **Step 3: Keep the last item clear of the bar**

Change these `android:paddingBottom` values to `@dimen/sg_bottom_bar_clearance` (keep `android:clipToPadding="false"`):
- `activity_word_bank.xml`: on `rvCategoryGrid` (currently `24dp`) and on `rvWords` (currently `20dp`).
- `activity_translation_history.xml`: on `rvHistory` (currently `24dp`).
- `activity_settings.xml`: on the `LinearLayout` directly inside the `NestedScrollView` (currently `android:paddingBottom="32dp"`).

- [ ] **Step 4: WordBankActivity**

In `app/src/main/kotlin/com/example/sigla/WordBankActivity.kt`:
1. Delete the fields `private lateinit var drawerLayout: DrawerLayout` and `private lateinit var btnSidebar: MaterialButton`.
2. In `onCreate`, delete the line `drawerLayout = findViewById(R.id.drawerLayout) // ← ADD THIS`, and replace the two calls `setupTopBar()` and `setupSidebar()` with:
```kotlin
        BottomNavHelper.setup(this, Tab.WORD_BANK)
```
3. In `bindViews()`, delete `drawerLayout = findViewById(R.id.drawerLayout)` and `btnSidebar = findViewById(R.id.btnSidebar)`.
4. Delete the whole `// ── Top bar ──` section (`setupTopBar()`) and the whole `// ── Sidebar ──` section (`setupSidebar()`).
5. At the end of `onCreate` (after the existing last statement), add `maybeFocusSearch(intent)`, and add these members to the class:
```kotlin
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeFocusSearch(intent)
    }

    /** Home's search bar opens this screen with the search field focused. */
    private fun maybeFocusSearch(intent: Intent) {
        if (!intent.getBooleanExtra(EXTRA_FOCUS_SEARCH, false)) return
        intent.removeExtra(EXTRA_FOCUS_SEARCH)
        if (!isGridMode) showGridMode()
        etSearch.requestFocus()
        etSearch.post {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            imm.showSoftInput(etSearch, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        }
    }
```
If the search field is not usable in grid mode in the current screen (check how `etSearch`'s text listener switches modes), drop the `if (!isGridMode) showGridMode()` line — the goal is only that the field is focused with the keyboard open.
6. Replace the `onBackPressed()` override with:
```kotlin
    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (!isGridMode) {
            showGridMode()
        } else {
            BottomNavHelper.open(this, Tab.HOME)
        }
    }
```
7. Remove imports that are now unused: `androidx.core.view.GravityCompat`, `androidx.drawerlayout.widget.DrawerLayout` (keep `MaterialButton` if `btnCategoryPill` still uses it). Add `import android.content.Intent` if not already imported.

- [ ] **Step 5: TranslationHistoryActivity**

In `app/src/main/kotlin/com/example/sigla/TranslationHistoryActivity.kt`:
1. Delete the fields `drawerLayout` and `btnSidebar`.
2. In `onCreate`, delete `drawerLayout = findViewById(R.id.drawerLayout)  // ← ADD THIS` and replace `setupTopBar()` + `setupSidebar()` with `BottomNavHelper.setup(this, Tab.HISTORY)`.
3. In `bindViews()`, delete the `drawerLayout = …` and `btnSidebar = …` lines.
4. Delete the `// ── Top bar ──` and `// ── Sidebar ──` sections.
5. Replace the `onBackPressed()` override with:
```kotlin
    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        BottomNavHelper.open(this, Tab.HOME)
    }
```
6. Remove the now-unused `GravityCompat` and `DrawerLayout` imports.

- [ ] **Step 6: SettingsActivity**

In `app/src/main/kotlin/com/example/sigla/SettingsActivity.kt`:
1. Delete the field `private lateinit var drawer: DrawerLayout` and the line `drawer = findViewById(R.id.drawerLayout)`.
2. Replace `setupTopBar()` + `setupSidebar()` in `onCreate` with `BottomNavHelper.setup(this, Tab.SETTINGS)`.
3. Delete the `// ── Top bar ──` and `// ── Sidebar ──` sections.
4. Replace the `onBackPressed()` override with:
```kotlin
    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        BottomNavHelper.open(this, Tab.HOME)
    }
```
5. Remove the now-unused `GravityCompat` and `DrawerLayout` imports.

- [ ] **Step 7: Build and test**

Run: `./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL; 76 tests pass. A compile error naming `drawerLayout`, `btnSidebar` or `sidebarDrawer` means a reference was missed in Steps 4–6.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/res/layout/activity_word_bank.xml app/src/main/res/layout/activity_translation_history.xml app/src/main/res/layout/activity_settings.xml app/src/main/kotlin/com/example/sigla/WordBankActivity.kt app/src/main/kotlin/com/example/sigla/TranslationHistoryActivity.kt app/src/main/kotlin/com/example/sigla/SettingsActivity.kt
git commit -m "feat(mobile): bottom bar replaces the drawer on Word Bank, History, Settings"
```

- [ ] **Step 9: Device check — back navigation (Review Focus 5)**

Install the debug APK and check, writing each result in the report:
1. Home → Word Bank tab → open a category list inside Word Bank (list mode) → Back → Word Bank grid → Back → Home.
2. Home → History → Back → Home. Home → Settings → Back → Home.
3. Home → Back → the app closes (it does not reveal another tab).
4. Word Bank: scroll the grid down, switch to History, switch back to Word Bank → the scroll position is kept.
5. The last grid card, last history entry and last settings row can be scrolled fully above the bottom bar.

---

### Task 7: Translator without the drawer; remove the old navigation

**Files:**
- Modify: `app/src/main/res/layout/activity_main.xml`, `app/src/main/kotlin/com/example/sigla/MainActivity.kt`
- Delete: `app/src/main/kotlin/com/example/sigla/NavigationHelper.kt`, `app/src/main/res/layout/nav_sidebar.xml`

**Interfaces:**
- Consumes: `Theme.Sigla.Immersive` (applied in Task 1).
- Produces: `MainActivity` reached only from Home/bottom bar; `binding.btnBack` replaces `binding.btnSidebar`.

The tap-to-sign code in `MainActivity` (frame routing in the landmark sink, `processCapture`, `handleTapEvent`, `renderTapState`, `cancelTap` and its call sites) must not change in this task.

- [ ] **Step 1: activity_main.xml root**

Replace the opening
```xml
<androidx.drawerlayout.widget.DrawerLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:id="@+id/drawerLayout"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <!-- ── Main content ── -->
    <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@color/sig_page_bg">
```
with
```xml
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/sig_page_bg">
```
and replace the end
```xml
    </androidx.constraintlayout.widget.ConstraintLayout>

    <!-- ── Sidebar ── -->
    <include layout="@layout/nav_sidebar" />

</androidx.drawerlayout.widget.DrawerLayout>
```
with
```xml
</androidx.constraintlayout.widget.ConstraintLayout>
```

- [ ] **Step 2: Hamburger → back button**

In `activity_main.xml`, on the `MaterialButton` with `android:id="@+id/btnSidebar"`:
- `android:id="@+id/btnSidebar"` → `android:id="@+id/btnBack"`
- `android:contentDescription="Open menu"` → `android:contentDescription="Back"`
- `app:icon="@drawable/ic_menu_lines"` → `app:icon="@drawable/ic_back"`

- [ ] **Step 3: MainActivity**

In `app/src/main/kotlin/com/example/sigla/MainActivity.kt`:
1. Delete the onboarding gate in `onCreate` — the block
```kotlin
        if (!appSettings.isOnboardingDone) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            return  // Exit onCreate, onboarding will start MainActivity when done
        }
```
Home now does this check (Task 5). Leave `setupComplete = true` and everything after it unchanged.
2. In `onCreate`, replace the call `setupSidebar()` with:
```kotlin
        // Back returns to whichever screen opened the translator.
        binding.btnBack.setOnClickListener { finish() }
```
3. Delete the whole `// ── Sidebar ──` section: the functions `setupSidebar()` and `setActiveNavItem(activeId: Int)` (from the `// ── Sidebar ──` comment down to the closing brace of `setActiveNavItem`).
4. Delete the `onBackPressed()` override (the one that checks `binding.drawerLayout.isDrawerOpen(GravityCompat.START)`), including its `@Deprecated` annotation. The default back behaviour (finish) is what we want.
5. Remove the `import androidx.core.view.GravityCompat` line. Remove any other import the compiler reports as unused only if it is clearly sidebar-related (`LinearLayout` was used only by `setActiveNavItem` at the time of writing — check before removing).

- [ ] **Step 4: Delete the old navigation**

```bash
git rm app/src/main/kotlin/com/example/sigla/NavigationHelper.kt app/src/main/res/layout/nav_sidebar.xml
```
Then search for leftovers:
```bash
grep -rn "NavigationHelper\|nav_sidebar\|sidebarDrawer\|navMainInterface\|navWordBank\|navTranslationHistory\|navSettings\|Screen\.MAIN" app/src/main
```
Expected: no output. Drawables such as `bg_nav_item_selected.xml` may remain unused; they are removed in Plan 2's cleanup, not here.

- [ ] **Step 5: Build and test**

Run: `./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL; 76 tests pass, including `TapSignSessionTest`, `ClipPreparerTest`, `ClipPreparerParityTest`, `TapAcceptanceTest`, unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/res/layout/activity_main.xml app/src/main/kotlin/com/example/sigla/MainActivity.kt
git commit -m "feat(mobile): translator opens from Home with a back button; drawer removed"
```

---

### Task 8: On-device check of Plan 1

**Files:** none (verification only). Record results in the task report.

- [ ] **Step 1: Install**

Run `./gradlew assembleDebug` and install the APK (see Environment).

- [ ] **Step 2: Check each item, in light mode and then with dark mode switched on in Settings**

1. Fresh start opens on **Home**, not the camera. If onboarding has not been completed, onboarding shows first and finishes into Home.
2. Greeting shows the right time-of-day line; no name has been set yet, so there is no avatar and no "Hi …!".
3. Search bar → Word Bank opens with the search field focused and the keyboard up.
4. "Open camera" and the centre button both open the translator. The translator shows its back button (not a hamburger), Back returns to the screen it came from, and tap-to-sign still records and shows a result.
5. After translating a word, Home's Today and Saved counts and Recent translations include it (return via Back).
6. Categories show up to 4 cards, the first in navy; tapping one opens that category's word list; "View all" opens Word Bank.
7. With the word bank never downloaded (fresh install with the phone offline, if a spare device is available): Home shows "Connect to the internet once to download the word bank." and no crash (Review Focus 2).
8. Bottom bar: the current tab is highlighted; switching tabs has no slide animation; the centre button sits in the bar's cradle.
9. Dark mode: Home, bottom bar and cards use the dark colours; text is readable everywhere on Home.
10. Word Bank, History and Settings still work as before apart from the drawer being gone (their old blue headers are expected until Plan 2).

- [ ] **Step 3: Report**

List any item that failed, with a screenshot description. Failures in items 1–9 are fixed before Plan 1 is considered done; item 10 visual oddities in the old headers are expected and go to Plan 2.
