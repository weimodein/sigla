"""
Tests for the augmentation pipeline, including the rotation and truncated-prefix
augmentations and the per-class RNG fix.

These are the safety net for changes that CANNOT be validated by cross_validate.py
in reasonable time: a mistake in rotation (e.g. rotating raw instead of normalized
coordinates, or perturbing an absent-hand sentinel) produces a model that trains
fine and scores fine on complete gestures while quietly degrading. Catch it here,
before a retrain.
"""

import numpy as np
import pytest

from app.utils.preprocessor import (
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    _POSE_BASE,
    augment_motion_sequences,
    mirror_sequence,
    rotate_sequence,
    truncated_prefix_sequence,
    prepare_motion_dataset,
)

from tests.test_parity import make_sequence


@pytest.fixture
def seq():
    """A normalized-looking 30-frame sequence with hand slot 0 and pose present."""
    return make_sequence(SEQUENCE_LENGTH, 15, pose=True, slot=0)


# ── Rotation ─────────────────────────────────────────────────────────────────

def test_rotation_preserves_shape(seq):
    out = rotate_sequence(seq, np.radians(12.0))
    assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE)


def test_rotation_by_zero_is_identity(seq):
    np.testing.assert_allclose(rotate_sequence(seq, 0.0), seq, rtol=1e-5, atol=1e-6)


def test_rotation_leaves_absent_blocks_zero(seq):
    """Slot 1 is absent in this fixture. Rotating (0,0) is (0,0) mathematically, but
    the absent-block sentinel must be preserved exactly -- the model reads all-zero
    as 'no hand detected'."""
    out = rotate_sequence(seq, np.radians(12.0))
    assert not np.any(out[:, 63:126]), "absent hand slot must remain exactly zero"


def test_rotation_preserves_intra_hand_distances(seq):
    """A rotation is rigid: distances between landmarks within a hand must not
    change. This is what distinguishes a correct rotation from an accidental shear
    or a rotation applied about the wrong origin."""
    out = rotate_sequence(seq, np.radians(20.0))
    frame_in, frame_out = seq[0], out[0]

    def dist(frame, a, b):
        return np.hypot(frame[a * 3] - frame[b * 3],
                        frame[a * 3 + 1] - frame[b * 3 + 1])

    for a, b in ((0, 9), (0, 4), (4, 8), (8, 12), (12, 20)):
        assert dist(frame_out, a, b) == pytest.approx(dist(frame_in, a, b), rel=1e-4)


def test_rotation_leaves_z_untouched(seq):
    """z is a depth estimate on a different scale from x/y; rotating it into the
    xy-plane would mix incompatible units."""
    out = rotate_sequence(seq, np.radians(15.0))
    for j in range(21):
        np.testing.assert_allclose(out[:, j * 3 + 2], seq[:, j * 3 + 2],
                                   rtol=1e-5, atol=1e-6)


def test_rotation_actually_changes_xy(seq):
    """Guard against a no-op implementation passing every invariant above."""
    out = rotate_sequence(seq, np.radians(20.0))
    assert not np.allclose(out[:, 0:63], seq[:, 0:63], atol=1e-4)


def test_rotation_is_additive(seq):
    """Rotating by a then b equals rotating by a+b -- confirms a true rotation
    matrix rather than a per-axis approximation."""
    a, b = np.radians(10.0), np.radians(15.0)
    np.testing.assert_allclose(
        rotate_sequence(rotate_sequence(seq, a), b),
        rotate_sequence(seq, a + b),
        rtol=1e-4, atol=1e-5,
    )


# ── Truncated prefix ─────────────────────────────────────────────────────────

def test_prefix_preserves_shape(seq):
    for frac in (0.4, 0.5, 0.75, 0.85, 1.0):
        out = truncated_prefix_sequence(seq, frac)
        assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE), f"frac={frac}"


def test_prefix_keeps_leading_frames_verbatim(seq):
    """The kept portion must be the ORIGINAL leading frames -- this augmentation
    simulates a buffer that has only seen the gesture so far, not a resampling."""
    out = truncated_prefix_sequence(seq, 0.5)
    keep = int(round(SEQUENCE_LENGTH * 0.5))
    np.testing.assert_array_equal(out[:keep], seq[:keep])


def test_prefix_pads_by_repeating_last_kept_frame(seq):
    """Padding must repeat the last kept frame -- byte-identical to how
    PredictionService pads a short live buffer. Any other padding (zeros, wrap)
    would put training out of step with inference, which is the exact mismatch this
    augmentation exists to fix."""
    out = truncated_prefix_sequence(seq, 0.5)
    keep = int(round(SEQUENCE_LENGTH * 0.5))
    for i in range(keep, SEQUENCE_LENGTH):
        np.testing.assert_array_equal(out[i], seq[keep - 1])


def test_prefix_full_fraction_is_identity(seq):
    np.testing.assert_array_equal(truncated_prefix_sequence(seq, 1.0), seq)


def test_prefix_clamps_degenerate_fractions(seq):
    """A fraction small enough to round to zero frames must still yield a valid
    30-frame sequence rather than an empty array."""
    out = truncated_prefix_sequence(seq, 0.001)
    assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE)
    for i in range(SEQUENCE_LENGTH):
        np.testing.assert_array_equal(out[i], seq[0])


# ── Mirror (pre-existing, currently disabled by default) ─────────────────────

def test_mirror_negates_x_and_is_involutive(seq):
    """Mirroring twice must return the original. Pinned because mirroring is
    off by default and would otherwise be untested when someone enables it."""
    once = mirror_sequence(seq)
    assert not np.allclose(once[:, 0:63], seq[:, 0:63], atol=1e-4)
    np.testing.assert_allclose(mirror_sequence(once), seq, rtol=1e-4, atol=1e-5)


# ── Augmentation driver ──────────────────────────────────────────────────────

def test_augmentation_reaches_target_count(seq):
    out = augment_motion_sequences([seq.tolist()], target_count=10,
                                   rng=np.random.default_rng(0))
    assert len(out) == 9   # target minus the 1 real sequence


def test_augmentation_outputs_correct_shape(seq):
    out = augment_motion_sequences([seq.tolist()], target_count=25,
                                   rng=np.random.default_rng(0))
    for i, a in enumerate(out):
        arr = np.array(a, dtype=np.float32)
        assert arr.shape == (SEQUENCE_LENGTH, FEATURE_SIZE), f"augmented[{i}]"


def test_augmentation_is_reproducible_for_same_rng(seq):
    a = augment_motion_sequences([seq.tolist()], 12, rng=np.random.default_rng(7))
    b = augment_motion_sequences([seq.tolist()], 12, rng=np.random.default_rng(7))
    np.testing.assert_allclose(np.array(a), np.array(b), rtol=1e-6)


def test_different_rng_produces_different_augmentation(seq):
    """THE per-class RNG fix. augment_motion_sequences is called once per class; it
    used to create default_rng(42) internally, so every class received identical
    augmentation types and identical noise draws -- correlated noise across classes
    rather than independent augmentation."""
    a = augment_motion_sequences([seq.tolist()], 12, rng=np.random.default_rng([42, 0]))
    b = augment_motion_sequences([seq.tolist()], 12, rng=np.random.default_rng([42, 1]))
    assert not np.allclose(np.array(a), np.array(b), atol=1e-4), \
        "two classes must not receive identical augmentation draws"


def test_augmentation_handles_empty_input():
    assert augment_motion_sequences([], target_count=10,
                                    rng=np.random.default_rng(0)) == []


def test_augmentation_does_not_resurrect_absent_hand(seq):
    """Slot 1 is absent throughout. No augmentation may invent data there -- except
    noise, which is applied densely by design. Verify the geometric augmentations
    specifically, since those are the ones that could silently break the sentinel."""
    for radians in (np.radians(-12.0), np.radians(12.0)):
        assert not np.any(rotate_sequence(seq, radians)[:, 63:126])
    for frac in (0.4, 0.6, 0.85):
        assert not np.any(truncated_prefix_sequence(seq, frac)[:, 63:126])


def test_pose_block_rotates_as_a_unit(seq):
    """The pose block is shoulder-midpoint-centred, so it must rotate about that
    origin -- shoulder separation is preserved under rotation."""
    out = rotate_sequence(seq, np.radians(18.0))

    def shoulder_width(frame):
        lx, ly = frame[_POSE_BASE + 1 * 3], frame[_POSE_BASE + 1 * 3 + 1]
        rx, ry = frame[_POSE_BASE + 2 * 3], frame[_POSE_BASE + 2 * 3 + 1]
        return np.hypot(rx - lx, ry - ly)

    assert shoulder_width(out[0]) == pytest.approx(shoulder_width(seq[0]), rel=1e-4)


# -- Dataset integrity / final-fit coverage -----------------------------------

def _sample(sequence, sample_id, label_session="session-a"):
    return {
        "sequence": sequence.tolist(),
        "sample_id": sample_id,
        "session_id": label_session,
    }


def test_exact_duplicates_are_removed_before_split(seq):
    other = seq.copy()
    other[:, 3] += 0.25
    dataset = {
        "A": [_sample(seq, 1), _sample(seq, 2), _sample(other, 3)],
        "B": [_sample(seq + 0.5, 4), _sample(seq + 0.75, 5)],
    }
    X, y, _, _, labels, counts = prepare_motion_dataset(dataset, train_all=True)
    # AUGMENTATION_FACTOR copies per unique real sequence.
    assert counts[0] == 2
    assert counts[1] == 2
    assert len(X) == 4 * 6
    assert set(y.tolist()) == set(labels.keys())


def test_cross_label_duplicate_fails_training(seq):
    dataset = {
        "A": [_sample(seq, 1)],
        "B": [_sample(seq, 2)],
    }
    with pytest.raises(ValueError, match="conflicting labels"):
        prepare_motion_dataset(dataset, train_all=True)


def test_train_all_uses_every_unique_real_sequence(seq):
    dataset = {}
    for class_idx, label in enumerate(("A", "B")):
        samples = []
        for i in range(5):
            varied = seq.copy()
            varied[:, 3] += class_idx + i * 0.1
            samples.append(_sample(varied, class_idx * 10 + i))
        dataset[label] = samples

    _, _, X_val, y_val, _, counts = prepare_motion_dataset(dataset, train_all=True)
    assert counts == {0: 5, 1: 5}
    assert len(X_val) == 0
    assert len(y_val) == 0
