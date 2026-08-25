import os
import re
import json
import numpy as np
from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import precision_score, recall_score, f1_score, classification_report, confusion_matrix
from app.utils.preprocessor import (
    fetch_approved_samples,
    prepare_motion_dataset,
    save_label_map,
    validate_training_coverage,
)
from app.utils.supabase_client import upload_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
MODELS_DIR      = "models"

# Global training seed. Without this only the augmentation RNG and the sklearn
# splits were seeded — TF weight init was not — so two runs on identical data
# produced different models and every A/B comparison was confounded by init noise.
# At ~2% cross-validation spread that noise is the same size as the effects being
# measured, which made changes impossible to evaluate honestly.
TRAIN_SEED = int(os.getenv("TRAIN_SEED", 42))

# Recurrent architecture. Defaults to the current plain LSTM so behaviour does not
# change until an A/B justifies it (tools/cross_validate.py).
#
#   lstm        — LSTM 128/64/32 (current production model)
#   bilstm_half — Bidirectional(LSTM 64/32/16). Bidirectional CONCATENATES the two
#                 directions, so halved units reproduce the current layer widths
#                 (64*2=128, 32*2=64, 16*2=32) at roughly the current parameter
#                 count. This isolates *how* the sequence is read from *how much*
#                 capacity the model has.
#   bilstm_full — Bidirectional(LSTM 128/64/32). Doubles both width and capacity.
#
# Running half and full together disambiguates a win: if full beats half, the gain
# came from capacity; if they tie, it came from bidirectionality. Either variant
# alone cannot separate the two.
#
# Bidirectionality is legitimate here because inference is NOT streaming-causal —
# PredictionService always evaluates a complete 30-frame window, so the "future"
# frames a backward pass reads are already in hand.
MODEL_ARCH = os.getenv("MODEL_ARCH", "lstm").strip().lower()
_VALID_ARCHS = ("lstm", "bilstm_half", "bilstm_full")

# Select the deployment epoch on a completely held-out signer. A random clip split
# puts every signer on both sides and produced the near-100% number that did not
# reproduce on a live user. The final model is still rebuilt on all approved clips.
GROUP_MODEL_SELECTION = os.getenv("GROUP_MODEL_SELECTION", "true").lower() == "true"
MODEL_SELECTION_SIGNER_FOLD = int(os.getenv("MODEL_SELECTION_SIGNER_FOLD", 0))


def set_global_seed(seed: int = TRAIN_SEED) -> None:
    """
    Seed Python's `random`, NumPy, and TensorFlow in one call, making weight init,
    dropout masks, and shuffling reproducible.

    Note this does NOT make training bit-exact on GPU: cuDNN kernel selection and
    non-deterministic reductions still vary. It removes the dominant source of
    run-to-run variance (initialization), which is what matters for A/B testing.
    """
    from tensorflow import keras
    keras.utils.set_random_seed(seed)


def build_motion_model(num_classes: int, arch: str | None = None):
    """
    Build the motion classifier. `arch` defaults to the MODEL_ARCH env var (see above).

    Everything except the three recurrent layers — Dense head, dropout rates, L2
    regularization, optimizer, learning rate — is identical across variants, so an
    A/B between them measures the recurrent change and nothing else.
    """
    from tensorflow import keras

    arch = (arch or MODEL_ARCH).strip().lower()
    if arch not in _VALID_ARCHS:
        raise ValueError(
            f"Unknown MODEL_ARCH '{arch}'. Expected one of: {', '.join(_VALID_ARCHS)}"
        )

    reg = keras.regularizers.l2(2e-4)

    # Reduced LSTM units (256→128→64 → 128→64→32) — prevents overfitting on limited
    # sequences. bilstm_half keeps those effective widths after concatenation.
    units = (64, 32, 16) if arch == "bilstm_half" else (128, 64, 32)

    def recurrent(n_units: int, return_sequences: bool):
        layer = keras.layers.LSTM(
            n_units,
            return_sequences=return_sequences,
            kernel_regularizer=reg,
            recurrent_regularizer=reg,
        )
        return layer if arch == "lstm" else keras.layers.Bidirectional(layer)

    model = keras.Sequential([
        keras.layers.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE)),
        recurrent(units[0], True),
        keras.layers.Dropout(0.4),
        recurrent(units[1], True),
        keras.layers.Dropout(0.4),
        recurrent(units[2], False),
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

    effective = tuple(u * 2 for u in units) if arch != "lstm" else units
    print(f"[train] architecture: {arch} — recurrent units {units}, "
          f"effective widths {effective}, {model.count_params():,} params")
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

    # Seed before anything touches TF, so weight init is reproducible.
    set_global_seed(TRAIN_SEED)

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

    # Refuse a flattering but non-generalizing model before spending minutes on
    # TensorFlow. Defaults require 20 unique clips from four signers per word.
    validate_training_coverage(motion_dataset)

    # ── Step 2: Train motion model (LSTM) ─────────────────────
    # Split happens BEFORE augmentation inside prepare_motion_dataset, so X_val/y_val
    # is real, unaugmented data the model never trained on — a genuine holdout.
    print(f"\n--- Training Motion Model (LSTM) — {total_classes} classes ---")
    X_train, y_train, X_val, y_val, motion_label_map, real_counts = prepare_motion_dataset(
        motion_dataset,
        fold=MODEL_SELECTION_SIGNER_FOLD if GROUP_MODEL_SELECTION else None,
        group_by_session=GROUP_MODEL_SELECTION,
    )

    selection_model = build_motion_model(len(motion_label_map))

    # Class weights from REAL pre-augmentation counts, not from y_train.
    #
    # What actually broke weighting was the old `target = max(len*6, 150)` floor: it
    # padded every class to exactly 150 samples, so compute_class_weight('balanced')
    # on y_train returned exactly 1.0 for every class. The code looked like it
    # handled imbalance while doing nothing at all. (Measured on a 9/2/6 split: 1.00x
    # spread with the floor, 4.50x without it.)
    #
    # With the floor gone, augmentation scales every class by the same factor, so
    # weighting on y_train and on real counts now agree exactly. Deriving from
    # real_counts anyway is a guarantee rather than a behaviour change: it decouples
    # weighting from the augmentation policy, so a future per-class factor — or a
    # re-introduced floor — cannot silently flatten the weights again.
    classes_present = np.array(sorted(real_counts.keys()), dtype=np.int64)
    real_labels = np.concatenate([
        np.full(real_counts[c], c, dtype=np.int64) for c in classes_present
    ])
    class_weights = compute_class_weight('balanced', classes=classes_present, y=real_labels)
    class_weight_dict = {int(c): float(w) for c, w in zip(classes_present, class_weights)}

    spread = max(class_weight_dict.values()) / max(min(class_weight_dict.values()), 1e-9)
    print(f"[train] class weights from real counts (spread {spread:.2f}x): "
          + ", ".join(f"{motion_label_map[c]}={class_weight_dict[c]:.2f}"
                      for c in sorted(class_weight_dict, key=class_weight_dict.get, reverse=True)[:3]))

    # Keep the optimizer schedule validation-independent. The final all-data fit
    # has no validation loss, so a ReduceLROnPlateau(val_loss) schedule selected
    # here could not be reproduced there. This also matches cross_validate.py.
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=20, restore_best_weights=True
        ),
    ]

    history = selection_model.fit(
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
    selection_predictions = (
        np.argmax(selection_model.predict(X_val, verbose=0), axis=1)
        if len(X_val) else np.array([], dtype=np.int64)
    )
    if len(X_val):
        accuracy = float(np.mean(selection_predictions == y_val))
        precision = float(precision_score(y_val, selection_predictions, average="weighted", zero_division=0))
        recall = float(recall_score(y_val, selection_predictions, average="weighted", zero_division=0))
        f1 = float(f1_score(y_val, selection_predictions, average="weighted", zero_division=0))
        ordered_indices = list(range(len(motion_label_map)))
        ordered_labels = [motion_label_map[i] for i in ordered_indices]
        report = classification_report(
            y_val, selection_predictions,
            labels=ordered_indices,
            target_names=ordered_labels,
            zero_division=0,
        )
        matrix = confusion_matrix(y_val, selection_predictions, labels=ordered_indices)
        confusions = sorted(
            (
                (int(matrix[t, p]), ordered_labels[t], ordered_labels[p])
                for t in ordered_indices for p in ordered_indices
                if t != p and matrix[t, p] > 0
            ),
            reverse=True,
        )
        confusion_lines = "\n".join(
            f"  {true_label} -> predicted as {pred_label}: {count}"
            for count, true_label, pred_label in confusions
        ) or "  (none - every held-out sample classified correctly)"
    else:
        accuracy = float(selection_best)
        precision = recall = f1 = accuracy
        report = "No held-out samples were available."
        confusion_lines = "  (no held-out samples)"

    selection_name = "held-out signer" if GROUP_MODEL_SELECTION else "random selection split"
    print(f"Motion model {selection_name} accuracy (restored weights): {accuracy:.4f}")
    print(f"  best epoch during training (optimistic, selection metric): {selection_best:.4f}")
    print(f"  NOTE: this split selected the epoch. For a multi-signer")
    print(f"        estimate run: python tools/cross_validate.py --group-by-session")

    # The holdout above chooses the epoch; it must not also cost the deployed model
    # 20% of the real recordings. Rebuild from fresh weights and fit a final model
    # on 100% of the deduplicated approved dataset for that fixed epoch count. The
    # validation score remains the selection model's score above -- evaluating the
    # all-data model on those same rows would be training accuracy, not evidence.
    best_epoch = int(np.argmax(history.history["val_accuracy"])) + 1
    print(f"[train] selected epoch {best_epoch}; rebuilding deployment model on 100% of real samples")

    del selection_model
    keras.backend.clear_session()
    set_global_seed(TRAIN_SEED)

    X_full, y_full, _, _, full_label_map, full_real_counts = prepare_motion_dataset(
        motion_dataset, random_state=TRAIN_SEED, train_all=True
    )
    if full_label_map != motion_label_map:
        raise ValueError("Label map changed between model selection and final fit")

    full_classes = np.array(sorted(full_real_counts.keys()), dtype=np.int64)
    full_real_labels = np.concatenate([
        np.full(full_real_counts[c], c, dtype=np.int64) for c in full_classes
    ])
    full_weights = compute_class_weight(
        'balanced', classes=full_classes, y=full_real_labels
    )
    full_weight_dict = {
        int(c): float(w) for c, w in zip(full_classes, full_weights)
    }

    model = build_motion_model(len(motion_label_map))
    model.fit(
        X_full, y_full,
        epochs=best_epoch,
        batch_size=32,
        class_weight=full_weight_dict,
        verbose=1,
    )

    # ── Step 3: Save + convert + upload ───────────────────────
    h5_path = os.path.join(version_dir, "sign_model_motion.h5")
    model.save(h5_path)
    tflite_path = convert_to_tflite(model, h5_path)

    label_map_path = os.path.join(version_dir, "labels_motion.json")
    save_label_map(motion_label_map, label_map_path)

    # Preserve the only honest pre-deployment evaluation. test.py must not load the
    # final all-data model and score rows that model trained on, which was the source
    # of the misleading near-100% "test" result in the admin UI.
    selection_metrics = {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "classification_report": report,
        "top_confusions": confusion_lines,
        "is_generalization_estimate": False,
        "evaluation_note": (
            "Measured on one completely held-out signer before the deployment model "
            "was rebuilt on all approved clips. This split selected the epoch; run "
            "tools/cross_validate.py --group-by-session for a multi-signer estimate."
            if GROUP_MODEL_SELECTION else
            "Measured on the epoch-selection split before the final all-data fit."
        ),
    }
    metrics_path = os.path.join(version_dir, "selection_metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(selection_metrics, f, indent=2)

    motion_tflite_url = upload_model_to_supabase(tflite_path, version_number, "motion")
    motion_h5_url     = upload_model_to_supabase(h5_path,     version_number, "motion_h5")

    with open(label_map_path, "rb") as f:
        upload_file(BUCKET_MODELS, f"{version_number}/labels_motion.json", f.read(), "application/json")
    with open(metrics_path, "rb") as f:
        upload_file(BUCKET_MODELS, f"{version_number}/selection_metrics.json", f.read(), "application/json")

    print(f"\n{'='*50}")
    print(f"Training complete for version: {version_number}")
    print(f"{'='*50}\n")

    # Every gesture is motion, so there is a single model — its values are
    # reported under the generic keys the backend and both clients read.
    return {
        "version_number":     version_number,
        "model_id":           model_id,
        "total_classes":      total_classes,
        # Restored-weights score on the epoch-selection split. It is held out by
        # signer by default, but still selected the epoch; grouped cross-validation
        # remains the trustworthy multi-signer number.
        "accuracy":           round(float(accuracy), 4),
        "selection_best_accuracy": round(float(selection_best), 4),
        "selected_epoch":      best_epoch,
        "deployment_real_samples": int(sum(full_real_counts.values())),
        "deployment_fit_samples": int(len(X_full)),
        "accuracy_note":      (
            "measured on a held-out signer used for epoch selection; run "
            "cross_validate.py --group-by-session for a multi-signer estimate"
            if GROUP_MODEL_SELECTION else
            "measured on the model-selection split; run cross_validate.py for a generalization estimate"
        ),
        "tflite_url":         motion_tflite_url,
        "h5_url":             motion_h5_url,
    }
