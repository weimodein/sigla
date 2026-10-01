"""Keys shared by the dataset audit and dedupe tools."""
import hashlib

import numpy as np


def class_key(label: str) -> str:
    """Curly and straight apostrophes both occur in the word list."""
    return label.replace("’", "'").strip().upper()


def sequence_hash(sequence) -> str:
    """
    Stable content hash of one 30x147 sequence.

    float32 because that is the dtype training uses -- hashing the raw JSON text
    would make formatting differences (trailing zeros, exponent form) look like
    different data.
    """
    return hashlib.sha1(
        np.asarray(sequence, dtype=np.float32).tobytes()
    ).hexdigest()
