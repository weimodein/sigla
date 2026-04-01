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
    prepare_static_dataset,
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

    # ── Step 1: Fetch approved samples ───────────────────────
    dataset = fetch_approved_samples()

    if len(dataset) < 2:
        raise ValueError("At least 2 gesture classes are required for evaluation.")

    # ── Step 2: Download static model from Supabase ───────────
    static_tflite_path = download_model_from_supabase(
        version_number, "sign_model_static.tflite"
    )

    # ── Step 3: Prepare static dataset ───────────────────────
    X_static, y_static, static_label_map = prepare_static_dataset(dataset)

    _, X_test_s, _, y_test_s = train_test_split(
        X_static, y_static,
        test_size=0.2,
        random_state=42,
        stratify=y_static
    )

    # ── Step 4: Evaluate static model ────────────────────────
    print("Evaluating static model...")
    static_interpreter = load_tflite_model(static_tflite_path)
    static_preds       = predict_tflite(static_interpreter, X_test_s)

    static_accuracy  = accuracy_score(y_test_s,  static_preds)
    static_precision = precision_score(y_test_s, static_preds, average="weighted", zero_division=0)
    static_recall    = recall_score(y_test_s,    static_preds, average="weighted", zero_division=0)
    static_f1        = f1_score(y_test_s,        static_preds, average="weighted", zero_division=0)

    static_report = classification_report(
        y_test_s,
        static_preds,
        target_names=[static_label_map[i] for i in range(len(static_label_map))],
        zero_division=0
    )

    print(f"Static Model Results:")
    print(f"  Accuracy:  {static_accuracy:.4f}")
    print(f"  Precision: {static_precision:.4f}")
    print(f"  Recall:    {static_recall:.4f}")
    print(f"  F1 Score:  {static_f1:.4f}")
    print(f"\nClassification Report:\n{static_report}")

    # ── Step 5: Evaluate motion model (if exists) ─────────────
    motion_results = None
    motion_dataset = {
        k: [s for s in v if "sequence" in s]
        for k, v in dataset.items()
    }
    motion_dataset = { k: v for k, v in motion_dataset.items() if v }

    if len(motion_dataset) >= 2:
        try:
            motion_tflite_path = download_model_from_supabase(
                version_number, "sign_model_motion.tflite"
            )

            X_motion, y_motion, motion_label_map = prepare_motion_dataset(motion_dataset)

            _, X_test_m, _, y_test_m = train_test_split(
                X_motion, y_motion,
                test_size=0.2,
                random_state=42,
                stratify=y_motion
            )

            print("\nEvaluating motion model...")
            motion_interpreter = load_tflite_model(motion_tflite_path)
            motion_preds       = predict_tflite(motion_interpreter, X_test_m)

            motion_accuracy  = accuracy_score(y_test_m,  motion_preds)
            motion_precision = precision_score(y_test_m, motion_preds, average="weighted", zero_division=0)
            motion_recall    = recall_score(y_test_m,    motion_preds, average="weighted", zero_division=0)
            motion_f1        = f1_score(y_test_m,        motion_preds, average="weighted", zero_division=0)

            motion_report = classification_report(
                y_test_m,
                motion_preds,
                target_names=[motion_label_map[i] for i in range(len(motion_label_map))],
                zero_division=0
            )

            print(f"Motion Model Results:")
            print(f"  Accuracy:  {motion_accuracy:.4f}")
            print(f"  Precision: {motion_precision:.4f}")
            print(f"  Recall:    {motion_recall:.4f}")
            print(f"  F1 Score:  {motion_f1:.4f}")
            print(f"\nClassification Report:\n{motion_report}")

            motion_results = {
                "accuracy":              round(float(motion_accuracy),  4),
                "precision":             round(float(motion_precision), 4),
                "recall":                round(float(motion_recall),    4),
                "f1_score":              round(float(motion_f1),        4),
                "classification_report": motion_report,
            }

        except Exception as e:
            print(f"Motion model evaluation skipped: {e}")

    print(f"\n{'='*50}")
    print(f"Evaluation complete for version: {version_number}")
    print(f"{'='*50}\n")

    return {
        "version_number": version_number,
        "model_id":       model_id,
        "static_model": {
            "accuracy":              round(float(static_accuracy),  4),
            "precision":             round(float(static_precision), 4),
            "recall":                round(float(static_recall),    4),
            "f1_score":              round(float(static_f1),        4),
            "classification_report": static_report,
        },
        "motion_model": motion_results,
    }