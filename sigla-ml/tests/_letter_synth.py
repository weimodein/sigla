"""Synthetic one-hand tracks shaped like real letter clips:
rest (no hand) -> raise -> hold [-> trace for J] -> lower -> rest.
Speeds are chosen against letters.SEGMENT_CONFIG: raise/lower/trace run at
several hand sizes per second, the hold well under HOLD_SPEED."""
import numpy as np


def _shape(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    pts = rng.normal(0, 0.05, size=(21, 3))
    pts[0] = 0.0
    return pts


def synth_hand(seed: int, center) -> list:
    return (_shape(seed) + np.asarray(center, dtype=float)).reshape(-1).tolist()


def synth_track(seed: int, kind: str = "static", fps: int = 24) -> list:
    shape = _shape(seed)
    rng = np.random.default_rng(seed + 1000)
    dt = 1000.0 / fps
    out, t = [], 0.0

    def add(center):
        nonlocal t
        if center is None:
            out.append({"t_ms": int(round(t)), "hand": None})
        else:
            p = shape + np.asarray(center, dtype=float) + rng.normal(0, 0.0005, shape.shape)
            out.append({"t_ms": int(round(t)), "hand": p.reshape(-1).tolist()})
        t += dt

    for _ in range(6):
        add(None)
    for k in range(10):                      # raise: y 1.2 -> 0.57
        add((0.5, 1.2 - 0.07 * k, 0.0))
    hold = 28 if kind == "static" else 8
    for _ in range(hold):                    # hold
        add((0.5, 0.5, 0.0))
    x, y = 0.5, 0.5
    if kind == "J":
        for _ in range(16):                  # trace
            x += 0.02
            y += 0.012
            add((x, y, 0.0))
        for _ in range(8):                   # settle
            add((x, y, 0.0))
    for k in range(10):                      # lower
        add((x, y + 0.07 * (k + 1), 0.0))
    for _ in range(8):
        add(None)
    return out
