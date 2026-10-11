import glob
import os

import pytest

from app.utils import letters as L

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_CLIPS = sorted(glob.glob(os.path.join(_ROOT, "datasets", "Alphabets", "A", "*", "*.MOV")))


_ANY = sorted(glob.glob(os.path.join(_ROOT, "datasets", "organized_clips", "0", "signer-01", "*.MOV")))


@pytest.mark.skipif(not _ANY, reason="no real clip on disk")
def test_hand_track_structure_on_any_real_clip():
    """Runs even without the letter clips: structure and units of the track."""
    from app.services.extract import extract_hand_track
    with open(_ANY[0], "rb") as f:
        track = extract_hand_track(f.read(), os.path.basename(_ANY[0]))
    assert track is not None and track["version"] == 1
    frames = track["frames"]
    ts = [f["t_ms"] for f in frames]
    assert len(frames) >= 10 and ts == sorted(ts)
    hands = [f["hand"] for f in frames if f["hand"] is not None]
    assert hands and all(len(h) == L.FLOATS for h in hands)
    # trimmed to the signing span: it starts and ends within the pad of a hand
    hits = [i for i, f in enumerate(frames) if f["hand"] is not None]
    assert hits[0] <= 4 and len(frames) - 1 - hits[-1] <= 4


@pytest.mark.skipif(not _CLIPS, reason="letter clips not on disk")
def test_hand_track_from_real_clip():
    from app.services.extract import extract_hand_track
    with open(_CLIPS[0], "rb") as f:
        track = extract_hand_track(f.read(), os.path.basename(_CLIPS[0]))
    assert track is not None and track["version"] == 1
    frames = track["frames"]
    assert len(frames) >= 24
    ts = [f["t_ms"] for f in frames]
    assert ts == sorted(ts)
    hands = [f["hand"] for f in frames if f["hand"] is not None]
    assert hands and all(len(h) == L.FLOATS for h in hands)
    assert L.static_samples(frames), "a real A clip must have a hold"
