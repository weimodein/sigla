# Mobile UI/UX Revamp — Design

**Date:** 2026-09-28
**Status:** Approved in design review, pending spec review
**Area:** sigla-mobile only
**Approved mockups:** `docs-internal/specs/2026-09-28-mobile-ui-revamp/`
(`home-v1.html`, `translator-v2.html`, `tabs-v1.html` — open in a browser; they are
HTML fragments, so page chrome is minimal, but each carries its own styles).
Where a mockup and this spec disagree, this spec wins — e.g. the Home stat
labelled "Translations" in the mockup is "Saved" here, and emoji in the mockups
stand in for outline icons.

## 1. Goal

Give the SIGLA Android app one consistent, modern visual language and a clearer
structure, modelled on a reference design the owner supplied: deep navy on white,
pale blue-tinted cards, a friendly greeting header, rounded search, 2-column cards,
list rows with round icon badges, and a bottom tab bar with a raised centre button.
The reference is a different kind of app; only its layout and visual style are
adopted, not its content.

### Success criteria

- Every screen uses the same colours, type scale, spacing and components.
- The app opens on a Home dashboard; translating is one tap away from anywhere.
- The translator's tap-to-sign and Live behaviour is unchanged; only its look changes.
- Light and dark themes both look deliberate, not like one is an afterthought.
- Existing unit tests keep passing; new logic is unit-tested.

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope | All screens (full app revamp) |
| Launch screen | New Home dashboard (replaces the translator as launcher) |
| Navigation | Bottom bar: Home · Word Bank · [Translate] · History · Settings; side drawer removed |
| Centre button | Opens the translator full-screen |
| Home sections | Greeting + hero card, stats card, categories grid, recent translations |
| Greeting name | Optional first name asked at the end of onboarding, stored on the phone, editable in Settings |
| Brand colour | Navy `#13306B` replaces `#4A90E2` |
| Theme | Light by default; matching dark theme kept as a Settings toggle |
| Translator layout | Full-screen camera, no bottom bar, compact ~150dp bottom sheet |
| Category colours | Uniform pale cards with one navy highlight; per-category colours retired |
| Build approach | Keep one Activity per screen; shared design system in XML resources (no Fragments, no Compose) |

## 3. Structure and navigation

| Screen | Change | Reached from |
|---|---|---|
| **Home** | New `HomeActivity`, the launcher activity | App start, Home tab |
| Word Bank, History, Settings | Re-laid-out, gain the bottom bar | Bottom-bar tabs |
| Translator (`MainActivity`) | Restyled; full-screen, no bottom bar, back arrow to Home | Centre button, Home hero card |
| Category word list, Word detail, Fullscreen video | Restyled | Word Bank / Home |
| Onboarding | Restyled, plus a name step | First launch, Settings → Replay tutorial |

- **Bottom bar:** Material `BottomAppBar` with a docked centre
  `FloatingActionButton`, as one shared layout, wired by a new `BottomNavHelper`
  on the four tab screens.
- **Tab switching:** start the target Activity with
  `FLAG_ACTIVITY_REORDER_TO_FRONT` and no transition animation, so tabs behave
  like tabs and keep their scroll position. The tab screens already use
  `launchMode="singleTop"`.
- **Removed:** `nav_sidebar.xml`, the drawer in each screen, and `NavigationHelper`.
- **Onboarding gate:** the `isOnboardingDone` check moves from `MainActivity`
  to `HomeActivity`.
- **Translator lifecycle:** unchanged. It still acquires the camera and models on
  start and releases them on stop. Because Home is now the launcher, the models
  load when the translator first opens rather than at app start.

## 4. Design system

All values live in shared resources; screens never hard-code colours, sizes or
spacing.

### Colour

| Token | Light | Dark (`values-night`) |
|---|---|---|
| Brand / filled cards, buttons | `#13306B` | `#2A55B8` |
| Brand text on background | `#13306B` | `#9DB8F2` |
| Background | `#FFFFFF` | `#0B1530` |
| Tint (cards, search, badges, chips) | `#EEF3FC` | `#15244B` |
| Bottom bar | `#FFFFFF` | `#101D3F` |
| Text primary | `#0F1B33` | `#E8EDF7` |
| Text secondary | `#0F1B33` @ 62% | `#E8EDF7` @ 62% |
| Divider | `#13306B` @ 8% | `#FFFFFF` @ 6% |
| Danger / recording / SOS | `#E53935` | `#E53935` |
| Success status dot | `#2E7D32` | `#2E7D32` |

- Red is used only for recording, SOS and destructive actions.
- Shadows are navy-tinted (light) or black at low alpha (dark), never plain grey.

### Dark mode default

`AppSettings.isDarkMode` defaults to `false` (today: `true`). A user whose stored
preference is `true` keeps dark mode; only users with no stored value change to
light.

### Typography

Poppins only. Four sizes, two weights (Regular, SemiBold). `poppins_semibold.ttf`
is added; Medium and Bold are no longer used by revamped screens.

| Role | Size | Weight |
|---|---|---|
| Screen title, greeting | 22sp | SemiBold |
| Card title, translation result | 17sp | SemiBold |
| Body, list titles | 13sp | Regular (list titles SemiBold) |
| Caption, secondary | 11sp | Regular |

### Spacing and shape

- Spacing on an 8-point grid: 4, 8, 12, 16, 24, 32dp.
- Screen side padding 20dp; section gap 20dp; card internal padding 12–16dp.
- Corner radii: large cards 24dp, small cards 20dp, chips/buttons 16dp,
  search bar and badges fully round.
- All tap targets at least 48dp.

### Components (one definition each)

Search bar · section header with "View all" · hero card · navy stat card ·
category card (tint and navy variants) · list row with round icon badge ·
chip/pill (on/off) · grouped settings card with rows and toggles · bottom bar
with centre button · compact translator bottom sheet.

### Icons

One outline icon set, extending the existing `ic_*_line` vectors (house, book,
history, settings, camera, tag…). Missing icons are added in the same style:
search, star, chat bubble, letter, SOS, hand (centre button). No emoji ship.

## 5. Screens

Layouts follow the approved mockups.

- **Home:** greeting ("Hi {name}!" / time-of-day line) with an initial avatar;
  search bar (opens Word Bank with the search focused); hero card "Start
  translating" with an Open camera button; navy stat card (Today · Saved ·
  Favorites); Categories grid (2 columns, first card navy, "View all" → Word
  Bank); Recent translations (last 3, "View all" → History).
- **Translator:** camera fills the screen above a ~150dp rounded bottom sheet.
  Over the camera: back arrow (top-left), Tap/Live pill (top-centre), flip
  camera (top-right), floating result card (word + Filipino). Record button
  above the sheet; while recording it turns red, reads "Stop", and shows
  "Recording… N.Ns" (new; the elapsed time was specified for tap-to-sign but
  never built). The sheet holds: status line with a "Hold for SOS" pill on the
  same row; Words / Letters / Filipino chips; one-line hint. Live mode replaces
  the record button with the existing live status readout.
- **Word Bank:** title + word count; search; filter pills (All · Words · Letters
  · My collections) replacing the category dropdown; section header with
  "+ Collection"; 2-column category grid with Favorites as the navy card.
- **Category word list / Word detail / Fullscreen video:** same list rows,
  cards and header styles.
- **History:** navy summary card ("N / 200 entries kept", Clear all); rows
  grouped under date headers, each with badge, word, Filipino translation, time.
- **Settings:** navy profile card (initial avatar, name, "Tap to change your
  name"); existing settings regrouped into rounded cards Audio / Display / App
  with icon badges and toggles. No settings are added or removed except the name.
- **Onboarding:** restyled pages, plus a final optional "What should we call
  you?" step with a text field and Skip.
- **Dialogs and bottom sheets:** restyled to the same radii, colours and type.

## 6. Data

- **New setting:** `AppSettings.userName: String?` (trimmed; blank stored as null).
  Set by the onboarding name step and the Settings profile card.
- **Home reads only on-device data**, so it works offline:

  | Section | Source |
  |---|---|
  | Greeting | Current hour + `userName` |
  | Today | History entries whose timestamp falls on today (local time) |
  | Saved | History entry count (history is capped at 200) |
  | Favorites | `FavoritesManager` count |
  | Categories | `ModelUpdateManager` cached word bank and categories |
  | Recent | Newest 3 history entries |

- Home recomputes on every `onResume`. It never triggers a network refresh;
  Word Bank keeps doing that.

## 7. Empty and edge states

- No name → greeting shows only the time-of-day line ("Good morning").
- Time of day: morning before 12:00, afternoon 12:00–17:59, evening from 18:00.
- No history → stats show 0; Recent shows "Your translations will appear here"
  with a Start translating button.
- No cached words (first launch offline) → Categories shows "Connect to the
  internet once to download the word bank" instead of an empty grid.
- Long names are truncated with an ellipsis on one line.

## 8. Testing

- New pure-Kotlin logic, unit-tested with JUnit:
  - greeting text from hour and optional name, including the boundary hours;
  - home stats from a list of history entries (today counting by local date)
    and a favorites count;
  - category selection and ordering for the Home grid.
- The existing 63 Kotlin unit tests and the sigla-ml suite keep passing.
- Tap-to-sign logic (`TapSignSession`, `ClipPreparer`, frame routing,
  `processCapture`, cancel call sites) is not modified; translator changes are
  layout and styling only, plus the elapsed-time text.
- Each phase ends with an on-device check of the affected screens in light and
  dark.

## 9. Build order

Each phase leaves the app working.

1. Design system: colours (light + dark), type, spacing, shapes, component
   styles, icons, SemiBold font, dark-mode default.
2. Home + bottom bar: `HomeActivity` as launcher, `BottomNavHelper`, drawer
   removed from all screens, onboarding gate moved.
3. Translator restyle, including the recording timer.
4. Word Bank, category word list, word detail, fullscreen video.
5. History and Settings, including the name setting.
6. Onboarding restyle and the name step.
7. Dark-theme pass and a final on-device check of every screen.

## 10. Out of scope

- Accounts, login, or syncing the name anywhere off the phone.
- Notifications (the reference's bell icon).
- New features beyond the name setting and the recording timer.
- Migrating to Fragments or Jetpack Compose.
- Changes to the model, backend, admin panel, or translation logic.
