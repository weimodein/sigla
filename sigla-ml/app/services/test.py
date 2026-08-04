import os
import json
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
)
from app.utils.preprocessor import (
    fetch_approved_samples,
    prepare_motion_dataset,
)
from app.utils.supabase_client import download_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
MODELS_DIR      = "models"


def predict_keras(model, input_data: np.ndarray) -> np.ndarray:
    """Run the Keras (.h5) model on a batch and return predicted class indices.

    We evaluate the Keras model rather than the .tflite because the LSTM's TFLite
    build uses Select-TF (Flex) ops, which the Python tf.lite.Interpreter does not
    register. Keras runs the LSTM natively with identical weights.
    """
    probs = model.predict(input_data, verbose=0)
    return np.argmax(probs, axis=1)


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

    # ── Step 2: Download the Keras (.h5) motion model ─────────
    # We evaluate the .h5 rather than the .tflite: the LSTM's TFLite build needs
    # Select-TF (Flex) ops that the Python tf.lite.Interpreter can't load. The
    # .h5 has identical weights and runs the LSTM natively in Keras.
    h5_path = download_model_from_supabase(version_number, "sign_model_motion.h5")

    # ── Step 3: Prepare + split ───────────────────────────────
    # Same split logic (and random_state) as train.py, so X_test/y_test here is the
    # identical real, unaugmented holdout the model's val_accuracy was measured
    # against during training — a genuine evaluation, not data it trained on.
    _, _, X_test, y_test, motion_label_map = prepare_motion_dataset(motion_dataset)

    # ── Step 4: Evaluate ──────────────────────────────────────
    print("Evaluating motion model...")
    from tensorflow import keras
    model = keras.models.load_model(h5_path)
    preds = predict_keras(model, X_test)

    accuracy  = accuracy_score(y_test,  preds)
    precision = precision_score(y_test, preds, average="weighted", zero_division=0)
    recall    = recall_score(y_test,    preds, average="weighted", zero_division=0)
    f1        = f1_score(y_test,        preds, average="weighted", zero_division=0)

    report = classification_report(
        y_test, preds,
        target_names=[motion_label_map[i] for i in range(len(motion_label_map))],
        zero_division=0
    )

    # Per-class precision/recall shows a class is weak but not WHICH other class it's
    # being confused with. Surface the top confusions explicitly (e.g. "NO -> YES: 3")
    # so a weak class's likely culprit is visible without manually reading a full matrix.
    labels_sorted = [motion_label_map[i] for i in range(len(motion_label_map))]
    cm = confusion_matrix(y_test, preds, labels=list(range(len(motion_label_map))))
    confusions = []
    for true_idx, row in enumerate(cm):
        for pred_idx, count in enumerate(row):
            if true_idx != pred_idx and count > 0:
                confusions.append((count, labels_sorted[true_idx], labels_sorted[pred_idx]))
    confusions.sort(reverse=True)
    # Plain ASCII only — Windows' default console/log encoding (cp1252) can't print
    # arrows/em-dashes and would crash this function after the (expensive) evaluation
    # already ran, discarding the result instead of returning it.
    confusion_lines = "\n".join(
        f"  {true_label} -> predicted as {pred_label}: {count}"
        for count, true_label, pred_label in confusions
    ) or "  (none - every class classified correctly)"

    print(f"Motion Model Results:")
    print(f"  Accuracy:  {accuracy:.4f}")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")
    print(f"\nClassification Report:\n{report}")
    print(f"Top confusions (true -> predicted):\n{confusion_lines}")

    print(f"\n{'='*50}")
    print(f"Evaluation complete for version: {version_number}")
    print(f"{'='*50}\n")

    metrics = {
        "accuracy":              round(float(accuracy),  4),
        "precision":             round(float(precision), 4),
        "recall":                round(float(recall),    4),
        "f1_score":              round(float(f1),        4),
        "classification_report": report,
        "top_confusions":        confusion_lines,
    }

    return {
        "version_number": version_number,
        "model_id":       model_id,
        "motion_model":   metrics,
    }