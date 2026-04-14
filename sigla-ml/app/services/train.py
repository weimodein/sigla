import os
import re
import json
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from app.utils.preprocessor import (
    fetch_approved_samples,
    prepare_static_dataset,
    prepare_motion_dataset,
    save_label_map,
)
from app.utils.supabase_client import upload_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    126))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
MODELS_DIR      = "models"


def build_static_model(num_classes: int):
    import tensorflow as tf
    from tensorflow import keras
    model = keras.Sequential([
        keras.layers.Input(shape=(FEATURE_SIZE,)),
        keras.layers.Dense(512, activation="relu"),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.4),
        keras.layers.Dense(256, activation="relu"),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.4),
        keras.layers.Dense(128, activation="relu"),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(64, activation="relu"),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(num_classes, activation="softmax"),
    ], name="sigla_static_model")

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.0005),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model


def build_motion_model(num_classes: int):
    import tensorflow as tf
    from tensorflow import keras
    model = keras.Sequential([
        keras.layers.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE)),
        keras.layers.LSTM(256, return_sequences=True),
        keras.layers.Dropout(0.4),
        keras.layers.LSTM(128, return_sequences=True),
        keras.layers.Dropout(0.4),
        keras.layers.LSTM(64, return_sequences=False),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(128, activation="relu"),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(num_classes, activation="softmax"),
    ], name="sigla_motion_model")

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.0005),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model


def convert_to_tflite(model, save_path: str, use_select_ops: bool = False) -> str:
    """
    Convert a Keras model to TFLite.

    Static (MLP) models convert with TFLITE_BUILTINS only.
    Motion (LSTM) models require SELECT_TF_OPS because LSTM uses TensorList ops
    that cannot be lowered to built-in TFLite ops with static shapes.
    The Android app must include tensorflow-lite-select-tf-ops to run these.
    """
    import tensorflow as tf
    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    # Disable optimizations to avoid advanced op versions (like FULLY_CONNECTED v12)
    converter.optimizations = []

    if use_select_ops:
        # LSTM uses TensorListReserve which requires the Select TF ops delegate.
        # The mobile app must include tensorflow-lite-select-tf-ops to run this model.
        converter.target_spec.supported_ops = [
            tf.lite.OpsSet.TFLITE_BUILTINS,
            tf.lite.OpsSet.SELECT_TF_OPS,
        ]
        converter._experimental_lower_tensor_list_ops = False
        print("  Using SELECT_TF_OPS for LSTM TFLite conversion")
    else:
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]

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
    dataset       = fetch_approved_samples()
    total_classes = len(dataset)

    if total_classes < 2:
        raise ValueError("At least 2 gesture classes are required for training.")

    # ── Step 2: Train static model ────────────────────────────
    print("\n--- Training Static Model (MLP) ---")
    X_static, y_static, static_label_map = prepare_static_dataset(dataset)

    if len(static_label_map) < 2:
        raise ValueError("At least 2 static gesture classes with valid feature data are required.")

    X_train_s, X_val_s, y_train_s, y_val_s = train_test_split(
        X_static, y_static, test_size=0.2, random_state=42, stratify=y_static
    )

    static_model = build_static_model(len(static_label_map))

    # Calculate class weights for imbalanced data
    from sklearn.utils.class_weight import compute_class_weight
    class_weights = compute_class_weight('balanced', classes=np.unique(y_train_s), y=y_train_s)
    class_weight_dict = dict(enumerate(class_weights))

    static_callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=15, restore_best_weights=True
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=7
        ),
    ]

    static_history = static_model.fit(
        X_train_s, y_train_s,
        validation_data=(X_val_s, y_val_s),
        epochs=200,
        batch_size=16,
        callbacks=static_callbacks,
        class_weight=class_weight_dict,
        verbose=1,
    )

    static_accuracy = max(static_history.history["val_accuracy"])
    print(f"Static model best val accuracy: {static_accuracy:.4f}")

    static_h5_path     = os.path.join(version_dir, "sign_model_static.h5")
    static_model.save(static_h5_path)
    static_tflite_path = convert_to_tflite(static_model, static_h5_path)

    static_label_map_path = os.path.join(version_dir, "labels_static.json")
    save_label_map(static_label_map, static_label_map_path)

    # ── Step 3: Train motion model (if motion samples exist) ──
    motion_tflite_url = None
    motion_h5_url     = None
    motion_accuracy   = None

    motion_dataset = {
        k: [s for s in v if "sequence" in s]
        for k, v in dataset.items()
    }
    motion_dataset = { k: v for k, v in motion_dataset.items() if v }

    if len(motion_dataset) >= 2:
        print(f"\n--- Training Motion Model (LSTM) — {len(motion_dataset)} motion classes ---")
        X_motion, y_motion, motion_label_map = prepare_motion_dataset(motion_dataset)

        X_train_m, X_val_m, y_train_m, y_val_m = train_test_split(
            X_motion, y_motion, test_size=0.2, random_state=42, stratify=y_motion
        )

        motion_model = build_motion_model(len(motion_label_map))

        # Calculate class weights for imbalanced data
        motion_class_weights = compute_class_weight('balanced', classes=np.unique(y_train_m), y=y_train_m)
        motion_class_weight_dict = dict(enumerate(motion_class_weights))

        motion_callbacks = [
            keras.callbacks.EarlyStopping(
                monitor="val_accuracy", patience=15, restore_best_weights=True
            ),
            keras.callbacks.ReduceLROnPlateau(
                monitor="val_loss", factor=0.5, patience=7
            ),
        ]

        motion_history = motion_model.fit(
            X_train_m, y_train_m,
            validation_data=(X_val_m, y_val_m),
            epochs=200,
            batch_size=16,
            callbacks=motion_callbacks,
            class_weight=motion_class_weight_dict,
            verbose=1,
        )

        motion_accuracy = max(motion_history.history["val_accuracy"])
        print(f"Motion model best val accuracy: {motion_accuracy:.4f}")

        motion_h5_path     = os.path.join(version_dir, "sign_model_motion.h5")
        motion_model.save(motion_h5_path)
        motion_tflite_path = convert_to_tflite(motion_model, motion_h5_path, use_select_ops=True)

        motion_label_map_path = os.path.join(version_dir, "labels_motion.json")
        save_label_map(motion_label_map, motion_label_map_path)

        motion_tflite_url = upload_model_to_supabase(motion_tflite_path, version_number, "motion")
        motion_h5_url     = upload_model_to_supabase(motion_h5_path,     version_number, "motion_h5")
    else:
        motion_classes_found = len(motion_dataset)
        print(f"\nWARNING: Motion model NOT trained — found {motion_classes_found} motion gesture class(es), need at least 2.")
        print("Motion classes in dataset:", list(motion_dataset.keys()) if motion_dataset else "none")

    # ── Step 4: Upload static model to Supabase ───────────────
    static_tflite_url = upload_model_to_supabase(static_tflite_path, version_number, "static")
    static_h5_url     = upload_model_to_supabase(static_h5_path,     version_number, "static_h5")

    with open(static_label_map_path, "rb") as f:
        upload_file(BUCKET_MODELS, f"{version_number}/labels_static.json", f.read(), "application/json")

    if motion_dataset and len(motion_dataset) >= 2:
        with open(motion_label_map_path, "rb") as f:
            upload_file(BUCKET_MODELS, f"{version_number}/labels_motion.json", f.read(), "application/json")

    print(f"\n{'='*50}")
    print(f"Training complete for version: {version_number}")
    print(f"{'='*50}\n")

    return {
        "version_number":    version_number,
        "model_id":          model_id,
        "total_classes":     total_classes,
        "accuracy":          round(float(static_accuracy), 4),
        "motion_accuracy":   round(float(motion_accuracy), 4) if motion_accuracy else None,
        "motion_trained":    motion_tflite_url is not None,
        "motion_classes":    len(motion_dataset),
        "tflite_url":        static_tflite_url,
        "h5_url":            static_h5_url,
        "motion_tflite_url": motion_tflite_url,
        "motion_h5_url":     motion_h5_url,
    }