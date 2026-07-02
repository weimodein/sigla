# MediaPipe model bundles

`extract.py` uses the MediaPipe **Tasks** HandLandmarker API, which requires the
`hand_landmarker.task` model bundle to be present in this directory.

The `.task` binary is not committed (it's ~7.8 MB — gitignored). Download it once:

```bash
curl -sSL -o app/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

Override the location with the `HAND_LANDMARKER_MODEL` env var if you store it
elsewhere.
