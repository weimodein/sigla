import os
import json
import numpy as np
from app.utils.supabase_client import supabase, BUCKET_GESTURES
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    126))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))


def fetch_approved_samples() -> dict:
    """
    Fetch all approved gesture samples from Supabase Storage.
    Returns a dict: { label: [sample_array, ...] }
    """
    print("Fetching approved samples from Supabase...")

    # List all files in the approved folder
    files = supabase.storage.from_(BUCKET_GESTURES).list("approved")

    if not files:
        raise ValueError("No approved samples found in Supabase Storage.")

    dataset = {}

    for file in files:
        filename  = file["name"]
        file_path = f"approved/{filename}"

        # Skip non-JSON files
        if not filename.endswith(".json"):
            continue

        # Download the file
        raw_bytes = supabase.storage.from_(BUCKET_GESTURES).download(file_path)
        data      = json.loads(raw_bytes.decode("utf-8"))

        label   = data.get("label")
        samples = data.get("samples", [])

        if not label or not samples:
            print(f"Skipping {filename} — missing label or samples")
            continue

        if label not in dataset:
            dataset[label] = []

        dataset[label].extend(samples)
        print(f"Loaded {len(samples)} samples for '{label}' from {filename}")

    if not dataset:
        raise ValueError("No valid samples found after processing files.")

    print(f"Total classes found: {len(dataset)}")
    return dataset


def prepare_static_dataset(dataset: dict):
    """
    Prepare dataset for static gesture model (MLP).
    Each sample is a single frame of FEATURE_SIZE landmarks.
    Returns X (features), y (labels), label_map (index → label)
    """
    X      = []
    y      = []
    labels = sorted(dataset.keys())

    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    for label, samples in dataset.items():
        for sample in samples:
            features = sample.get("features", [])
            if len(features) != FEATURE_SIZE:
                continue
            X.append(features)
            y.append(label_idx[label])

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    print(f"Static dataset — X: {X.shape}, y: {y.shape}, classes: {len(labels)}")
    return X, y, label_map


def prepare_motion_dataset(dataset: dict):
    """
    Prepare dataset for motion gesture model (LSTM).
    Each sample is a sequence of SEQUENCE_LENGTH frames.
    Returns X (sequences), y (labels), label_map (index → label)
    """
    X      = []
    y      = []
    labels = sorted(dataset.keys())

    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    for label, samples in dataset.items():
        for sample in samples:
            sequence = sample.get("sequence", [])
            if not sequence:
                continue

            # Pad or trim to SEQUENCE_LENGTH
            if len(sequence) < SEQUENCE_LENGTH:
                # Pad by repeating last frame
                while len(sequence) < SEQUENCE_LENGTH:
                    sequence.append(sequence[-1])
            elif len(sequence) > SEQUENCE_LENGTH:
                sequence = sequence[:SEQUENCE_LENGTH]

            if len(sequence[0]) != FEATURE_SIZE:
                continue

            X.append(sequence)
            y.append(label_idx[label])

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    print(f"Motion dataset — X: {X.shape}, y: {y.shape}, classes: {len(labels)}")
    return X, y, label_map


def save_label_map(label_map: dict, path: str) -> None:
    """
    Save label map as JSON file locally.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"Label map saved to {path}")


def load_label_map(path: str) -> dict:
    """
    Load label map from JSON file.
    """
    with open(path, "r") as f:
        return json.load(f)