import os
import re
import numpy as np
from sklearn.utils.class_weight import compute_class_weight
from app.utils.preprocessor import (
    fetch_approved_samples,
    partition_dataset_by_word_type,
    prepare_static_dataset,
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


def build_static_model(num_classes: int):
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


def convert_to_tflite(model, save_path: str, use_select_ops: bool = True) -> str:
    """
    Convert a Keras model to TFLite. The motion (LSTM) model uses TensorList ops
    that cannot be lowered to built-in TFLite ops with static shapes, so
    SELECT_TF_OPS is required for it — the Android app must include
    tensorflow-lite-select-tf-ops to run it. The static (MLP) model needs no such
    ops and converts with plain TFLITE_BUILTINS.
    """
    import tensorflow as tf
    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    # Disable optimizations to avoid advanced op versions (like FULLY_CONNECTED v12)
    converter.optimizations = []
    if use_select_ops:
        converter.target_spec.supported_ops = [
            tf.lite.OpsSet.TFLITE_BUILTINS,
            tf.lite.OpsSet.SELECT_TF_OPS,
        ]
        converter._experimental_lower_tensor_list_ops = False
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

    # ── Step 1: Fetch approved samples, route each WORD to exactly one model ──
    # A word's type (static vs motion) is decided from the majority of its own
    # samples' extracted data — see partition_dataset_by_word_type. Never a
    # manual admin flag. The two resulting label sets are disjoint, so the two
    # models never compete for the same word at inference time.
    dataset = fetch_approved_samples()
    static_dataset, motion_dataset = partition_dataset_by_word_type(dataset)
    total_classes = len(static_dataset) + len(motion_dataset)

    if len(static_dataset) < 2 and len(motion_dataset) < 2:
        raise ValueError(
            f"At least 2 gesture classes routed to the same model (static or "
            f"motion) are required (found {len(static_dataset)} static, "
            f"{len(motion_dataset)} motion)."
        )

    result = {
        "version_number": version_number,
        "model_id":       model_id,
        "total_classes":  total_classes,
    }

    # ── Step 2: Train static model (MLP), if enough static classes exist ──────
    if len(static_dataset) >= 2:
        print(f"\n--- Training Static Model (MLP) — {len(static_dataset)} classes ---")
        X_train_s, y_train_s, X_val_s, y_val_s, static_label_map = prepare_static_dataset(static_dataset)

        static_model = build_static_model(len(static_label_map))
        static_class_weights = compute_class_weight(
            'balanced', classes=np.unique(y_train_s), y=y_train_s
        )
        static_class_weight_dict = dict(enumerate(static_class_weights))

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
            class_weight=static_class_weight_dict,
            verbose=1,
        )
        static_accuracy = max(static_history.history["val_accuracy"])
        print(f"Static model best val accuracy: {static_accuracy:.4f}")

        static_h5_path = os.path.join(version_dir, "sign_model_static.h5")
        static_model.save(static_h5_path)
        static_tflite_path = convert_to_tflite(static_model, static_h5_path, use_select_ops=False)

        static_label_map_path = os.path.join(version_dir, "labels_static.json")
        save_label_map(static_label_map, static_label_map_path)

        static_tflite_url = upload_model_to_supabase(static_tflite_path, version_number, "static")
        static_h5_url     = upload_model_to_supabase(static_h5_path,     version_number, "static_h5")
        with open(static_label_map_path, "rb") as f:
            upload_file(BUCKET_MODELS, f"{version_number}/labels_static.json", f.read(), "application/json")

        result.update({
            "static_accuracy":   round(float(static_accuracy), 4),
            "static_classes":    len(static_label_map),
            "static_tflite_url": static_tflite_url,
            "static_h5_url":     static_h5_url,
        })
    else:
        print(f"\n--- Skipping Static Model — only {len(static_dataset)} static class(es) (need >= 2) ---")

    # ── Step 3: Train motion model (LSTM), if enough motion classes exist ────
    # Split happens BEFORE augmentation inside prepare_motion_dataset, so X_val/y_val
    # is real, unaugmented data the model never trained on — a genuine holdout.
    if len(motion_dataset) >= 2:
        print(f"\n--- Training Motion Model (LSTM) — {len(motion_dataset)} classes ---")
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

        accuracy = max(history.history["val_accuracy"])
        print(f"Motion model best val accuracy: {accuracy:.4f}")

        h5_path = os.path.join(version_dir, "sign_model_motion.h5")
        model.save(h5_path)
        tflite_path = convert_to_tflite(model, h5_path, use_select_ops=True)

        label_map_path = os.path.join(version_dir, "labels_motion.json")
        save_label_map(motion_label_map, label_map_path)

        motion_tflite_url = upload_model_to_supabase(tflite_path, version_number, "motion")
        motion_h5_url     = upload_model_to_supabase(h5_path,     version_number, "motion_h5")

        with open(label_map_path, "rb") as f:
            upload_file(BUCKET_MODELS, f"{version_number}/labels_motion.json", f.read(), "application/json")

        # Generic keys carry the motion model's values, for backward compatibility
        # with the backend/mobile app code that already reads these unprefixed keys.
        result.update({
            "accuracy":   round(float(accuracy), 4),
            "tflite_url": motion_tflite_url,
            "h5_url":     motion_h5_url,
        })
    else:
        print(f"\n--- Skipping Motion Model — only {len(motion_dataset)} motion class(es) (need >= 2) ---")

    print(f"\n{'='*50}")
    print(f"Training complete for version: {version_number}")
    print(f"{'='*50}\n")

    return result
