import os
import json
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
)
from sklearn.model_selection import train_test_split
from app.utils.preprocessor import (
    fetch_approved_samples,
    prepare_motion_dataset,
)
from app.utils.supabase_client import download_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    126))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
MODELS_DIR      = "models"


def load_tflite_model(tflite_path: str):
    import tensorflow as tf
    interpreter = tf.lite.Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()
    return interpreter


def predict_tflite(interpreter, input_data: np.ndarray) -> np.ndarray:
    input_details  = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    predictions = []
    for sample in input_data:
        input_array = np.expand_dims(sample, axis=0).astype(np.float32)
        interpreter.set_tensor(input_details[0]["index"], input_array)
        interpreter.invoke()
        output = interpreter.get_tensor(output_details[0]["index"])
        predictions.append(np.argmax(output[0]))

    return np.array(predictions)


def download_model_from_supabase(version_number: str, filename: str) -> str:
    storage_path = f"{version_number}/{filename}"
    local_dir    = os.path.join(MODELS_DIR, version_number)
    local_path   = os.path.join(local_dir, filename)

    os.makedirs(local_dir, exist_ok=True)

    if os.path.exists(local_path):
        print(f"Model already exists locally: {local_path}")
        return local_path

    print(f"Downloading {filename} from Supabase...")
    file_bytes = download_file(BUCKET_MODELS, storage_path)

    with open(local_path, "wb") as f:
        f.write(file_bytes)

    print(f"Downloaded to {local_path}")
    return local_path


def test(version_number: str, model_id: int) -> dict:
    print(f"\n{'='*50}")
    print(f"Starting evaluation for version: {version_number}")
    print(f"{'='*50}\n")

    # ── Step 1: Fetch approved samples (all motion sequences) ──
    dataset = fetch_approved_samples()

    motion_dataset = {
        k: [s for s in v if "sequence" in s]
        for k, v in dataset.items()
    }
    motion_dataset = { k: v for k, v in motion_dataset.items() if v }

    if len(motion_dataset) < 2:
        raise ValueError("At least 2 gesture classes with sequence data are required for evaluation.")

    # ── Step 2: Download the motion model ─────────────────────
    tflite_path = download_model_from_supabase(version_number, "sign_model_motion.tflite")

    # ── Step 3: Prepare + split ───────────────────────────────
    X_motion, y_motion, motion_label_map = prepare_motion_dataset(motion_dataset)
    _, X_test, _, y_test = train_test_split(
        X_motion, y_motion, test_size=0.2, random_state=42, stratify=y_motion
    )

    # ── Step 4: Evaluate ──────────────────────────────────────
    print("Evaluating motion model...")
    interpreter = load_tflite_model(tflite_path)
    preds       = predict_tflite(interpreter, X_test)

    accuracy  = accuracy_score(y_test,  preds)
    precision = precision_score(y_test, preds, average="weighted", zero_division=0)
    recall    = recall_score(y_test,    preds, average="weighted", zero_division=0)
    f1        = f1_score(y_test,        preds, average="weighted", zero_division=0)

    report = classification_report(
        y_test, preds,
        target_names=[motion_label_map[i] for i in range(len(motion_label_map))],
        zero_division=0
    )

    print(f"Motion Model Results:")
    print(f"  Accuracy:  {accuracy:.4f}")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")
    print(f"\nClassification Report:\n{report}")

    print(f"\n{'='*50}")
    print(f"Evaluation complete for version: {version_number}")
    print(f"{'='*50}\n")

    metrics = {
        "accuracy":              round(float(accuracy),  4),
        "precision":             round(float(precision), 4),
        "recall":                round(float(recall),    4),
        "f1_score":              round(float(f1),        4),
        "classification_report": report,
    }

    return {
        "version_number": version_number,
        "model_id":       model_id,
        "motion_model":   metrics,
    }