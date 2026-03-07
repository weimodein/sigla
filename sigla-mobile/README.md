# SIGLA — Native Kotlin Android App

## Project Structure
```
sigla_kotlin/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/                        ← PUT YOUR MODEL FILES HERE
│       │   ├── hand_landmarker.task
│       │   ├── sign_model_static.tflite
│       │   ├── sign_model_motion.tflite
│       │   ├── labels_static.json
│       │   ├── labels_motion.json
│       │   └── gesture_config.json
│       ├── kotlin/com/example/sigla/
│       │   ├── MainActivity.kt            ← Main inference screen
│       │   ├── CollectionActivity.kt      ← Training data collection
│       │   ├── PredictionService.kt       ← Dual-race prediction logic
│       │   ├── HandLandmarkHelper.kt      ← MediaPipe wrapper
│       │   └── OverlayView.kt             ← Hand skeleton drawing
│       └── res/
│           ├── layout/
│           │   ├── activity_main.xml
│           │   ├── activity_collection.xml
│           │   └── dialog_collection_config.xml
│           └── values/
│               ├── themes.xml
│               └── strings.xml
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

## Setup Steps

### 1. Open in Android Studio
File → Open → select the `sigla_kotlin` folder

### 2. Copy asset files into app/src/main/assets/
- hand_landmarker.task
- sign_model_static.tflite
- sign_model_motion.tflite
- labels_static.json
- labels_motion.json
- gesture_config.json

### 3. Add app icons (required to build)
Add ic_launcher.png and ic_launcher_round.png to each mipmap folder,
OR right-click res → New → Image Asset in Android Studio.

### 4. Build and run
Click Run ▶ in Android Studio, or:
```
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Workflow: Collect New Training Data
1. Tap "Collect Data" button in the app
2. Enter label (e.g. HELLO), set motion toggle
3. Collect 300 samples — auto-captures like Python script
4. Files saved to: Android/data/com.example.sigla/files/Documents/sigla_dataset/LABEL/

## Workflow: Retrain Models
1. Transfer sigla_dataset/ folder from phone to PC (USB)
2. Place next to your Python scripts
3. Run: python convert_collection.py --input sigla_dataset --output dataset_landmarks
4. Run: python train_landmarks.py
5. Run: python convert_to_tflite.py
6. Copy new .tflite files back to app/src/main/assets/
7. Rebuild app
