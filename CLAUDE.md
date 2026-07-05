# SIGLA — Filipino Sign Language recognition

Motion-only sign recognition: an LSTM over 30-frame × 126-feature windows
(2 hands × 21 MediaPipe landmarks × xyz). Four components:

- **sigla-backend/** — Node/Express + Sequelize (Postgres) + Supabase Storage.
  Serves `/api/models/latest` to mobile. Deploy/revert/checksum plumbing in
  `src/controllers/modelController.js`.
- **sigla-ml/** — Python FastAPI. Train/test/deploy in `app/services/`; feature
  math in `app/utils/preprocessor.py`.
- **sigla-admin/** — React (Vite) admin web. Model UI in
  `src/pages/model/ManageModel.jsx`.
- **sigla-mobile/** — Android (Kotlin): `MainActivity.kt`,
  `HandLandmarkHelper.kt`, `PredictionService.kt`, `ModelUpdateManager.kt`.

## Working agreements (how the user wants me to work)

- **One isolated, testable change at a time.** The user often cannot tell which
  of several simultaneous changes caused a regression. Do not bundle changes.
- **Don't guess — measure.** Prefer diagnostics (logs, confusion matrix, A/B a
  known-good model) over hypotheses when accuracy is in question.
- **The user runs their own services** (ML, backend) and deploys manually. Don't
  run deploys or long-running servers for them; give clear step-by-step actions.

## Hard invariants (do not break)

- **Parity is sacred.** Landmark/feature math in Python (`preprocessor.py`) and
  Kotlin (`HandLandmarkHelper.kt` / `MainActivity.kt`) must be byte-identical.
  Any change to normalization, chirality, or slot ordering must be mirrored on
  both sides AND requires a retrain. Use the `parity-checker` agent.
- **Absent hand = 63 zeros** (the "no hand" sentinel). Every transform must skip
  all-zero blocks and never corrupt them.
- **Feature layout:** 126 floats = slot0 (0..62) + slot1 (63..125). Normalize =
  wrist-center (landmark 0) + scale by 2D wrist→landmark-9 distance, eps `1e-6`.
  Slot canonicalization (RIGHT→slot0) runs BEFORE the orientation mirror.

## Gotchas learned the hard way

- **Restart the ML service before retraining.** A running Python process holds
  the imported `preprocessor` in memory; editing the `.py` on disk does nothing
  until restart. Several "retrains" silently used stale code because of this.
- **Offline test accuracy is misleading.** `test.py` evaluates on ~80% augmented
  data → it reports ~100% regardless. Real accuracy only shows on-device. Add a
  confusion matrix to see class collisions; don't trust the headline number.
- **Model files share one storage path.** Every version is copied to
  `deployed/sign_model_motion.tflite`. Deploy AND revert must re-upload the
  version's bytes and recompute the checksum, or the app's checksum check fails
  and it reports "No model." The API appends a `?v=&t=` cache-buster to defeat
  stale Supabase CDN copies.
- **LSTM .tflite needs Select-TF/Flex ops** — mobile bundles them; the Python
  `tf.lite.Interpreter` can't load them, so `test.py` evaluates the `.h5`.
- **Logcat is mostly MIUI/vendor noise.** `--------- beginning of crash` is a
  section header, not a crash. Use the `logcat-triage` agent for big dumps.

## Subagents (in .claude/agents/)

- **parity-checker** — verify Python↔Kotlin feature math is identical.
- **ml-pipeline-reviewer** — go/no-go review before a retrain.
- **logcat-triage** — extract the signal from a big Android log.
- **codebase-explorer** — read-only "where/how is X" across components.

## Model workflow

Add Word → Upload videos → **restart ML service** → Train → Test → Deploy →
app auto-pulls via `ModelUpdateManager`. Retrain (not re-upload) is needed when
feature layout changes; chirality/normalization are recovered from stored raw
sequences at train time.
