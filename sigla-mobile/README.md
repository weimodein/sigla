# SIGLA Mobile

Native Android application for Filipino Sign Language recognition and learning.

## Features

- Live camera-based sign translation with text and speech output
- Public word bank with categories, favorites, and demonstration media
- Device-local translation history
- Device-local application settings and onboarding

The mobile application has no user accounts, authentication, profiles, or notifications. It only calls public backend endpoints for the deployed recognition models, word bank, and categories.

## Run locally

1. Open `sigla-mobile` in Android Studio.
2. Set the debug `BASE_URL` in `app/build.gradle.kts` to the backend address reachable by the Android device.
3. Build and run the `app` configuration.

From a terminal:

```text
./gradlew assembleDebug
```

On Windows, use `gradlew.bat assembleDebug`.

## Main source areas

- `MainActivity.kt` — camera translation
- `WordBankActivity.kt` — word browsing and categories
- `WordDetailActivity.kt` — word details and demonstration media
- `TranslationHistoryActivity.kt` — local translation history
- `SettingsActivity.kt` — local application preferences
- `PredictionService.kt` — on-device model inference
- `HandLandmarkHelper.kt` — MediaPipe landmark extraction
