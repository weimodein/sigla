"""Behaviour of the pure clip-preparation pipeline shared with sigla-mobile."""
import numpy as np
import pytest

from app.services.clip_prep import (
    ExtractionQualityError,
    finalize_sampled,
    sample_budget,
    sample_indices,
)
from tests._tap_clip_synth import FINALIZE_CASES, SAMPLE_CASES, synth_sampled


def test_sample_budget_is_86():
    # ceil(30 / 0.35) = 86, between the 60 floor and the 120 ceiling.
    assert sample_budget() == 86


@pytest.mark.parametrize("total,fps", SAMPLE_CASES)
def test_sample_indices_are_in_range_and_ordered(total, fps):
    plan = sample_indices(total, fps)
    idx = plan.indices
    assert len(idx) >= 1
    assert idx.min() >= 0 and idx.max() <= total - 1
    assert np.all(np.diff(idx) >= 0)


def test_rate_path_samples_at_24fps():
    # 60 frames at 30 fps: stride 1.25 -> 48 samples, inside [30, 86].
    plan = sample_indices(60, 30.0)
    assert len(plan.indices) == 48 and not plan.over_budget


def test_over_budget_falls_back_to_even_spread():
    plan = sample_indices(250, 60.0)  # rate path wants 100 > 86
    assert plan.over_budget and len(plan.indices) == 86


@pytest.mark.parametrize("case", FINALIZE_CASES, ids=[c[0] for c in FINALIZE_CASES])
def test_finalize_cases(case):
    name, pattern, slope, peak_at, jump, total, fps, expected = case
    sampled = synth_sampled(pattern, slope, peak_at, jump)
    if expected is None:
        window = finalize_sampled(sampled, total, fps)
        assert window.shape == (30, 147)
        assert window.dtype == np.float32
    else:
        with pytest.raises(ExtractionQualityError) as err:
            finalize_sampled(sampled, total, fps)
        assert err.value.reason == expected
