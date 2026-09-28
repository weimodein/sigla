# Mobile UI/UX Revamp — Design

**Date:** 2026-09-28
**Status:** Approved in design review, pending spec review
**Area:** sigla-mobile (plus one additive field on the backend word-bank endpoint)
**Approved mockups:** `docs-internal/specs/2026-09-28-mobile-ui-revamp/`
(`home-v1.html`, `translator-v2.html`, `tabs-v1.html`, `words-v1.html` (list
option A was chosen) — open in a browser; they are
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
| Word lists | One word per row: thumbnail, word, Filipino translation, favorite star |
| Word detail | Video first, word + Filipino + speak button, "Try it yourself", pinned Download / Favorites bar |
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
- **Word Bank:** title + word count; search; filter pills (All · Words ·
  Letters) replacing the category dropdown; 2-column category grid with
  Favorites as the navy card. Pills filter the grid: All shows Favorites, All
  Words and every category; Words / Letters show only categories containing
  words of that vocabulary. The mockup's "My collections" pill and
  "+ Collection" header are dropped (decided 2026-09-28): custom collections
  cannot be created or filled anywhere in the app today, so showing them would
  be a new feature, which §10 excludes. The dormant rename/delete collection
  code in WordBankActivity is left as is.
- **Word rows** (category word list, and Word Bank search results): a tint
  row with 20dp radius, 52dp rounded thumbnail on the left (sign image; a hand
  icon when there is none), word (SemiBold) with its Filipino translation below
  (secondary; omitted when absent), and a star on the right showing favorite
  state (display only; favoriting stays on the detail screen). One word per
  row — the 2-column grid option was rejected.
- **Category word list:** round back button, category title with word count,
  "Search in {category}…" bar, then word rows. Existing empty state ("No words
  found") restyled.
- **Word detail:** round back button with the category name; the demo video is
  the first element (24dp radius, 16:10-ish, poster = thumbnail) with a play
  overlay; its controls (play/pause, seek, time, replay, 0.5×/0.75×/1× speed,
  fullscreen) sit in a compact panel directly under the video rather than on
  top of it (decided 2026-09-28: overlaid controls would cover the signer's
  hands, and the speed buttons don't fit on the video); below that the
  word (26sp SemiBold — a deliberate display size for this one screen) with its
  Filipino translation and a round navy speak button; chips for category and
  "Saved offline"; a "Try it yourself" card (hand badge, "Open the translator
  and sign this word.") that opens the translator; a bottom bar pinned in the
  thumb zone with a square Download button and a full-width "Add to Favorites"
  / "Added to Favorites" button. The existing no-media placeholder, Retry and
  loading states are kept, restyled.
- **Fullscreen video:** unchanged. Its translucent dark controls over a black
  player already suit a video screen, and it keeps `Theme.Sigla.Immersive`.
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
- **Filipino translation** is already in `WordBankWord.filipino_translation`;
  the word screens start displaying it.
- **Vocabulary for "Try it yourself":**
  - Backend (only backend change in this project): `GET /api/words/word-bank`
    adds `vocabulary` (`"words"` | `"letters"`) to each word's `attributes`.
    Additive; older app versions ignore it.
  - App: `WordBankWord` gains `vocabulary: String? = null`. The cached word
    bank written before this change has no such field; it parses as null.
  - "Try it yourself" starts the translator with an intent extra for the
    word's vocabulary. The translator applies it once its predictor is ready
    (the predictor is created asynchronously) by calling the existing
    `setVocabulary`, only when the letters model is loaded; otherwise it stays
    on Words. A null or unknown vocabulary means no switch.

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
  - category selection and ordering for the Home grid;
  - mapping a word's vocabulary string to the translator's starting vocabulary
    (words, letters, null, unknown value, letters model not loaded).
- Backend: confirm the word-bank response includes `vocabulary` (existing
  backend `npm test` keeps passing).
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
4. Word Bank, category word list, word detail (including Filipino translation
   and "Try it yourself"), fullscreen video. The backend `vocabulary` field
   ships and is deployed to Hostinger in this phase; the app must work whether
   or not the deployed backend sends it yet.
5. History and Settings, including the name setting.
6. Onboarding restyle and the name step.
7. Dark-theme pass and a final on-device check of every screen.

## 10. Out of scope

- Accounts, login, or syncing the name anywhere off the phone.
- Notifications (the reference's bell icon).
- New features beyond: the name setting, the recording timer, showing the
  Filipino translation on word screens, and "Try it yourself".
- Migrating to Fragments or Jetpack Compose.
- Changes to the model, admin panel, or translation logic; backend changes
  other than adding `vocabulary` to the word-bank response.
