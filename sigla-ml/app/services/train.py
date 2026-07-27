import os
import re
import numpy as np
from sklearn.utils.class_weight import compute_class_weight
from app.utils.preprocessor import (
    fetch_approved_samples,
    prepare_motion_dataset,
    save_label_map,
)
from app.utils.supabase_client import upload_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
MODELS_DIR      = "models"


def build_motion_model(num_classes: int):
    from tensorflow import keras
    reg = keras.regularizers.l2(2e-4)
    # Reduced LSTM units (256→128→64 → 128→64→32) — prevents overfitting on limited sequences
    model = keras.Sequential([
        keras.layers.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE)),
        keras.layers.LSTM(128, return_sequences=True, kernel_regularizer=reg, recurrent_regularizer=reg),
        keras.layers.Dropout(0.4),
        keras.layers.LSTM(64, return_sequences=True, kernel_regularizer=reg, recurrent_regularizer=reg),
        keras.layers.Dropout(0.4),
        keras.layers.LSTM(32, return_sequences=False, kernel_regularizer=reg, recurrent_regularizer=reg),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(64, activation="relu", kernel_regularizer=reg),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(num_classes, activation="softmax"),
    ], name="sigla_motion_model")

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.0005),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model


def convert_to_tflite(model, save_path: str) -> str:
    """
    Convert the motion (LSTM) Keras model to TFLite. LSTM uses TensorList ops
    that cannot be lowered to built-in TFLite ops with static shapes, so
    SELECT_TF_OPS is required. The Android app must include
    tensorflow-lite-select-tf-ops to run this model.
    """
    import tensorflow as tf
    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    # Disable optimizations to avoid advanced op versions (like FULLY_CONNECTED v12)
    converter.optimizations = []
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS,
        tf.lite.OpsSet.SELECT_TF_OPS,
    ]
    converter._experimental_lower_tensor_list_ops = False

    tflite_model = converter.convert()

    tflite_path = save_path.replace(".h5", ".tflite")
    with open(tflite_path, "wb") as f:
        f.write(tflite_model)

    print(f"TFLite model saved to {tflite_path}")
    return tflite_path


def upload_model_to_supabase(local_path: str, version_number: str, model_type: str) -> str:
    filename     = os.path.basename(local_path)
    storage_path = f"{version_number}/{filename}"

    with open(local_path, "rb") as f:
        file_bytes = f.read()

    content_type = (
        "application/octet-stream"
        if local_path.endswith(".tflite")
        else "application/x-hdf5"
    )

    url = upload_file(BUCKET_MODELS, storage_path, file_bytes, content_type)
    print(f"Uploaded {model_type} model to Supabase: {url}")
    return url


def train(version_number: str, model_id: int) -> dict:
    from tensorflow import keras

    # Strip any characters that are invalid in Supabase storage keys
    safe_version = re.sub(r"[^a-zA-Z0-9._\-]", "_", version_number)
    if safe_version != version_number:
        print(f"WARNING: version_number sanitized from '{version_number}' to '{safe_version}'")
    version_number = safe_version

    print(f"\n{'='*50}")
    print(f"Starting training for version: {version_number}")
    print(f"{'='*50}\n")

    os.makedirs(MODELS_DIR, exist_ok=True)
    version_dir = os.path.join(MODELS_DIR, version_number)
    os.makedirs(version_dir, exist_ok=True)

    # ── Step 1: Fetch approved samples ───────────────────────
    # Every sample is a motion sequence (30×126). All signs are trained as a
    # single motion LSTM model — there is no static/motion distinction.
    dataset = fetch_approved_samples()

    motion_dataset = {
        k: [s for s in v if "sequence" in s]
        for k, v in dataset.items()
    }
    motion_dataset = { k: v for k, v in motion_dataset.items() if v }
    total_classes  = len(motion_dataset)

    if total_classes < 2:
        raise ValueError(
            f"At least 2 gesture classes with valid sequence data are required "
            f"(found {total_classes})."
        )

    # ── Step 2: Train motion model (LSTM) ─────────────────────
    # Split happens BEFORE augmentation inside prepare_motion_dataset, so X_val/y_val
    # is real, unaugmented data the model never trained on — a genuine holdout.
    print(f"\n--- Training Motion Model (LSTM) — {total_classes} classes ---")
    X_train, y_train, X_val, y_val, motion_label_map = prepare_motion_dataset(motion_dataset)

    model = build_motion_model(len(motion_label_map))

    class_weights = compute_class_weight('balanced', classes=np.unique(y_train), y=y_train)
    class_weight_dict = dict(enumerate(class_weights))

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=20, restore_best_weights=True
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=10
        ),
    ]

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=200,
        batch_size=32,
        callbacks=callbacks,
        class_weight=class_weight_dict,
        verbose=1,
    )

    # `max(val_accuracy)` is the best epoch on the SAME split EarlyStopping used to
    # select the weights (restore_best_weights=True) — an optimistic maximum by
    # construction, not a measure of generalization. Report the restored model's
    # actual score on that split instead, and label it for what it is.
    #
    # For a trustworthy number run tools/cross_validate.py, which trains K folds and
    # scores every sample while held out. Nothing in this function can produce an
    # unbiased estimate: the split it evaluates is the split it selected on.
    selection_best = max(history.history["val_accuracy"])
    if len(X_val):
        _, accuracy = model.evaluate(X_val, y_val, verbose=0)
    else:
        accuracy = selection_best

    print(f"Motion model val accuracy (restored weights): {accuracy:.4f}")
    print(f"  best epoch during training (optimistic, selection metric): {selection_best:.4f}")
    print(f"  NOTE: both are measured on the model-selection split. For a")
    print(f"        generalization estimate run: python tools/cross_validate.py")

    # ── Step 3: Save + convert + upload ───────────────────────
    h5_path = os.path.join(version_dir, "sign_model_motion.h5")
    model.save(h5_path)
    tflite_path = convert_to_tflite(model, h5_path)

    label_map_path = os.path.join(version_dir, "labels_motion.json")
    save_label_map(motion_label_map, label_map_path)

    motion_tflite_url = upload_model_to_supabase(tflite_path, version_number, "motion")
    motion_h5_url     = upload_model_to_supabase(h5_path,     version_number, "motion_h5")

    with open(label_map_path, "rb") as f:
        upload_file(BUCKET_MODELS, f"{version_number}/labels_motion.json", f.read(), "application/json")

    print(f"\n{'='*50}")
    print(f"Training complete for version: {version_number}")
    print(f"{'='*50}\n")

    # Every gesture is motion, so there is a single model — its values are
    # reported under the generic keys the backend and both clients read.
    return {
        "version_number":     version_number,
        "model_id":           model_id,
        "total_classes":      total_classes,
        # Restored-weights score on the model-selection split. Still optimistic
        # (it is the split that selected the weights) but no longer the max over
        # 200 epochs. tools/cross_validate.py is the trustworthy number.
        "accuracy":           round(float(accuracy), 4),
        "selection_best_accuracy": round(float(selection_best), 4),
        "accuracy_note":      "measured on the model-selection split; run cross_validate.py for a generalization estimate",
        "tflite_url":         motion_tflite_url,
        "h5_url":             motion_h5_url,
    }
