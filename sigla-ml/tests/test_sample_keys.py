import numpy as np

from tools._sample_keys import class_key, sequence_hash


def test_class_key_folds_curly_apostrophes_and_case():
    assert class_key("  don’t know ") == "DON'T KNOW"
    assert class_key("Don't Know") == "DON'T KNOW"


def test_sequence_hash_ignores_json_formatting_differences():
    a = [[0.1, 0.25], [1.0, 0.0]]
    b = np.array([[0.10, 0.250], [1, 0]], dtype=np.float64)
    assert sequence_hash(a) == sequence_hash(b)
    assert sequence_hash(a) != sequence_hash([[0.1, 0.25], [1.0, 0.5]])
