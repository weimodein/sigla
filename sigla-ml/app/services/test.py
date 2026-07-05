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
    prepare_motion_dataset_split,
)
from app.utils.supabase_client import download_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))  # 126 hand + 21 pose
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

    # ── Step 3: Prepare honest held-out test set ──────────────
    # Evaluate on REAL clips only, held out before augmentation (same seed as
    # training, so these are the exact clips the model never trained on). This
    # gives a true generalization number instead of accuracy on memorized
    # augmented copies of the training data.
    _, _, X_test, y_test, motion_label_map = prepare_motion_dataset_split(
        motion_dataset, test_size=0.2, seed=42
    )
    if X_test.shape[0] == 0:
        raise ValueError(
            "No held-out real clips to evaluate on — every class has <2 clips. "
            "Collect more clips per word before testing."
        )

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

    print(f"Motion Model Results (REAL held-out clips):")
    print(f"  Accuracy:  {accuracy:.4f}")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")
    print(f"\nClassification Report:\n{report}")

    # ── Per-class accuracy table (which words hit bar) ──
    print("Per-class accuracy (held-out):")
    for i in range(len(motion_label_map)):
        mask = (y_test == i)
        n = int(mask.sum())
        if n == 0:
            print(f"  {motion_label_map[i]:<20} —      (no held-out clips)")
            continue
        acc_i = float((preds[mask] == i).mean())
        print(f"  {motion_label_map[i]:<20} {acc_i*100:5.1f}%  ({int((preds[mask]==i).sum())}/{n})")

    # ── Confusion diagnostic: which classes collide with which ──
    # X_test is REAL held-out clips (never augmented, never trained on), so these
    # numbers reflect genuine generalization. Read the OFF-DIAGONAL cells to see
    # which class pairs the model confuses: row = true label, column = predicted.
    labels_ordered = [motion_label_map[i] for i in range(len(motion_label_map))]
    cm = confusion_matrix(y_test, preds, labels=list(range(len(labels_ordered))))
    print("\nConfusion matrix (row = true, col = predicted):")
    header = "true \\ pred".ljust(18) + "".join(f"{i:>5}" for i in range(len(labels_ordered)))
    print(header)
    for i, row in enumerate(cm):
        line = f"{i:>2} {labels_ordered[i][:14]:<14}" + "".join(f"{v:>5}" for v in row)
        print(line)
    print("\nLegend:")
    for i, name in enumerate(labels_ordered):
        print(f"  {i:>2} = {name}")
    # Explicitly list the confused pairs (off-diagonal, count > 0)
    print("\nConfused pairs (true -> predicted : count):")
    any_confusion = False
    for i in range(len(labels_ordered)):
        for j in range(len(labels_ordered)):
            if i != j and cm[i][j] > 0:
                any_confusion = True
                print(f"  {labels_ordered[i]} -> {labels_ordered[j]} : {cm[i][j]}")
    if not any_confusion:
        print("  (none on this held-out split — but remember it is mostly augmented data)")

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