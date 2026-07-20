package com.example.sigla

// Process-scoped cache for the expensive, theme-independent objects owned by
// MainActivity (MediaPipe landmarkers and the TFLite predictor). MainActivity
// can still be recreated by the system (e.g. a real configuration change);
// these objects don't depend on the theme, so they're kept here and reused
// across that recreate instead of being rebuilt from scratch every time.
// (The TTS engine is no longer cached here — it's owned by SpeechHelper,
// a single shared instance for the whole app, not per-Activity.)
object MainSessionCache {
    var landmarker: HandLandmarkHelper? = null
    var predictor: PredictionService? = null
    var filipinoMap: Map<String, String>? = null

    fun clear() {
        landmarker = null
        predictor = null
        filipinoMap = null
    }
}
