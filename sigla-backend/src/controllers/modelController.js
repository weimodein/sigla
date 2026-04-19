const { Op } = require("sequelize");
const axios = require("axios");
const crypto = require("crypto");
const {
  ModelVersion,
  Word,
  User,
  // ActivityLog,
  Notification,
} = require("../models/index.js");
require("dotenv").config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET_MODELS =
  process.env.SUPABASE_BUCKET_MODELS || "model-files";

// ── Supabase helper: upload buffer to storage ─────────────────
async function uploadToSupabase(storagePath, buffer, contentType) {
  const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET_MODELS}/${storagePath}`;
  await axios.post(url, buffer, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    maxBodyLength: Infinity,
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_MODELS}/${storagePath}`;
}

// ── GET /api/models ───────────────────────────────────────────
// Get all model versions
const getAllModels = async (req, res) => {
  try {
    const models = await ModelVersion.findAll({
      include: [{ model: User, as: "trainer", attributes: ["id", "username"] }],
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({ models });
  } catch (err) {
    console.error("Get all models error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/models/stats ─────────────────────────────────────
// Get model statistics for dashboard
const getModelStats = async (req, res) => {
  try {
    const [total, deployed, trained] = await Promise.all([
      ModelVersion.count(),
      ModelVersion.count({ where: { status: "deployed" } }),
      ModelVersion.count({ where: { status: "trained" } }),
    ]);

    const deployedModel = await ModelVersion.findOne({
      where: { status: "deployed" },
      order: [["deployed_at", "DESC"]],
    });

    return res.status(200).json({
      total,
      deployed,
      trained,
      current_model: deployedModel || null,
    });
  } catch (err) {
    console.error("Get model stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/models/latest ────────────────────────────────────
// Mobile app: get the latest deployed model info + all file URLs
const getLatestModel = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({
      where: { status: "deployed" },
      attributes: [
        "id",
        "version_number",
        "tflite_url",
        "motion_tflite_url",
        "accuracy",
        "motion_accuracy",
        "deployed_at",
        "total_classes",
        "motion_classes",
        "motion_trained",
        "checksum",
      ],
      order: [["deployed_at", "DESC"]],
    });

    if (!model) {
      return res.status(404).json({ message: "No deployed model found" });
    }

    // All file URLs point to the fixed deployed/ folder in Supabase
    // so the mobile always fetches from a stable path regardless of version
    const base = SUPABASE_URL
      ? `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_MODELS}/deployed`
      : null;

    return res.status(200).json({
      model: {
        ...model.toJSON(),
        tflite_url: base
          ? `${base}/sign_model_static.tflite`
          : model.tflite_url,
        motion_tflite_url: base ? `${base}/sign_model_motion.tflite` : null,
        labels_static_url: base ? `${base}/labels_static.json` : null,
        labels_motion_url: base ? `${base}/labels_motion.json` : null,
        gesture_config_url: base ? `${base}/gesture_config.json` : null,
      },
    });
  } catch (err) {
    console.error("Get latest model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/models/:id ───────────────────────────────────────
// Get a single model version by ID
const getModelById = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({
      where: { id: req.params.id },
      include: [{ model: User, as: "trainer", attributes: ["id", "username"] }],
    });

    if (!model) {
      return res.status(404).json({ message: "Model not found" });
    }

    return res.status(200).json({ model });
  } catch (err) {
    console.error("Get model by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/models/train ────────────────────────────────────
// Admin triggers model training via FastAPI ML microservice.
// Returns 202 immediately so Render's 30-second proxy timeout is never hit.
// Training runs in a background async job; poll GET /api/models/:id/status.
const trainModel = async (req, res) => {
  try {
    const { version_number, notes } = req.body;

    if (!version_number) {
      return res.status(400).json({ message: "Version number is required" });
    }

    // Only allow characters that are safe in Supabase storage paths
    if (!/^[a-zA-Z0-9._\-]+$/.test(version_number)) {
      return res.status(400).json({
        message:
          "Version number can only contain letters, numbers, dots (.), dashes (-), and underscores (_). Special characters like backticks, spaces, or slashes are not allowed.",
      });
    }

    // Check if version number already exists
    const existing = await ModelVersion.findOne({ where: { version_number } });
    if (existing) {
      return res.status(409).json({ message: "Version number already exists" });
    }

    // Create record with status "training" — frontend polls this
    const modelRecord = await ModelVersion.create({
      version_number,
      notes: notes || null,
      trained_by: req.user.id,
      status: "training",
    });

    // Respond immediately — do NOT await training
    res.status(202).json({
      message: "Training started. Poll /api/models/:id/status for progress.",
      model: modelRecord,
    });

    // ── Background training job ───────────────────────────────
    (async () => {
      try {
        const response = await axios.post(
          `${ML_SERVICE_URL}/train`,
          { version_number, model_id: modelRecord.id },
          { timeout: 20 * 60 * 1000, headers: { "ngrok-skip-browser-warning": "1" } },
        );
        const r = response.data;
        await modelRecord.update({
          status:            "trained",
          accuracy:          r.accuracy           || null,
          total_classes:     r.total_classes       || null,
          tflite_url:        r.tflite_url          || null,
          h5_url:            r.h5_url              || null,
          motion_tflite_url: r.motion_tflite_url   || null,
          motion_h5_url:     r.motion_h5_url       || null,
          motion_accuracy:   r.motion_accuracy     || null,
          motion_trained:    r.motion_trained      || false,
          motion_classes:    r.motion_classes      || null,
          trained_at:        new Date(),
          training_error:    null,
        });
        console.log(`[trainModel] version ${version_number} training complete`);
      } catch (mlErr) {
        const detail =
          mlErr.response?.data?.detail ||
          mlErr.response?.data?.message ||
          mlErr.message ||
          "Unknown training error";
        console.error(`[trainModel] background training failed: ${detail}`);
        await modelRecord
          .update({ status: "failed", training_error: detail })
          .catch(() => {});
      }
    })();
  } catch (err) {
    console.error("Train model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/models/:id/status ────────────────────────────────
// Frontend polls this while training is in progress
const getModelStatus = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({
      where: { id: req.params.id },
      include: [{ model: User, as: "trainer", attributes: ["id", "username"] }],
    });
    if (!model) return res.status(404).json({ message: "Model not found" });
    return res.status(200).json({ model });
  } catch (err) {
    console.error("Get model status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/models/test ─────────────────────────────────────
// Admin tests a trained model before deploying
const testModel = async (req, res) => {
  try {
    const { model_id } = req.body;

    if (!model_id) {
      return res.status(400).json({ message: "Model ID is required" });
    }

    const model = await ModelVersion.findOne({ where: { id: model_id } });

    if (!model) {
      return res.status(404).json({ message: "Model not found" });
    }

    if (model.status === "deployed") {
      return res.status(400).json({ message: "Model is already deployed" });
    }

    // Call FastAPI ML microservice to test the model
    let testResult;
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/test`, {
        version_number: model.version_number,
        model_id: model.id,
      }, { headers: { "ngrok-skip-browser-warning": "1" } });
      testResult = response.data;
    } catch (mlErr) {
      if (mlErr.response) {
        const detail =
          mlErr.response.data?.detail ||
          mlErr.response.data?.message ||
          mlErr.message;
        console.error("ML service test error:", detail);
        return res.status(mlErr.response.status).json({ message: detail });
      }
      console.error("ML service unreachable:", mlErr.message);
      return res.status(503).json({
        message: "ML service unavailable. Make sure sigla-ml is running.",
      });
    }

    // Update model stats with test results
    await model.update({
      accuracy: testResult.accuracy || model.accuracy,
    });

    // Log activity
    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "tested_model",
    //   target_type: "model",
    //   target_id: model.id,
    //   details: `Tested model version ${model.version_number}. Accuracy: ${testResult.accuracy}`,
    // });

    return res.status(200).json({
      message: "Model tested successfully",
      test_result: testResult,
    });
  } catch (err) {
    console.error("Test model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/models/deploy ───────────────────────────────────
// Admin deploys a trained model — makes it the active model
const deployModel = async (req, res) => {
  try {
    const { model_id } = req.body;

    if (!model_id) {
      return res.status(400).json({ message: "Model ID is required" });
    }

    const model = await ModelVersion.findOne({ where: { id: model_id } });

    if (!model) {
      return res.status(404).json({ message: "Model not found" });
    }

    if (!model.tflite_url) {
      return res.status(400).json({
        message: "Model has no .tflite file. Train the model first.",
      });
    }

    // ── Upload model files to Supabase deployed folder ───────────────────────
    // Derive base URL from the static tflite file (assumes all files are in the same folder)
    const baseUrl = model.tflite_url.substring(
      0,
      model.tflite_url.lastIndexOf("/"),
    );

    // List of expected files – required ones must exist, optional ones are skipped if missing.
    // Motion model URL comes from the stored DB column (saved after training).
    // Labels URLs are derived from the versioned base path (same folder as the tflite files).
    const possibleFiles = [
      {
        url: model.tflite_url,
        name: "sign_model_static.tflite",
        required: true,
      },
      {
        url: `${baseUrl}/labels_static.json`,
        name: "labels_static.json",
        required: true,
      },
      {
        url: model.motion_tflite_url || null,
        name: "sign_model_motion.tflite",
        required: false,
      },
      {
        url: model.motion_tflite_url ? `${baseUrl}/labels_motion.json` : null,
        name: "labels_motion.json",
        required: false,
      },
      {
        url: `${baseUrl}/gesture_config.json`,
        name: "gesture_config.json",
        required: false,
      },
    ];

    for (const file of possibleFiles) {
      // Skip if the URL is missing or empty
      if (!file.url || file.url === "null") {
        if (file.required) {
          throw new Error(`Missing URL for required file: ${file.name}`);
        } else {
          console.warn(
            `Skipping optional file ${file.name} – no URL provided.`,
          );
          continue;
        }
      }

      try {
        const response = await axios.get(file.url, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        const buffer = Buffer.from(response.data);
        const contentType =
          response.headers["content-type"] ||
          (file.name.endsWith(".tflite")
            ? "application/octet-stream"
            : "application/json");
        await uploadToSupabase(`deployed/${file.name}`, buffer, contentType);
        console.log(
          `Uploaded ${file.name} -> ${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_MODELS}/deployed/${file.name}`,
        );
      } catch (err) {
        if (file.required) {
          console.error(
            `Failed to upload required file ${file.name}:`,
            err.message,
          );
          throw err; // fail the deployment if a required file is missing
        } else {
          console.warn(`Skipping optional file ${file.name}: ${err.message}`);
        }
      }
    }

    // ── Compute SHA256 checksum of the deployed static .tflite ──────────────
    // Computed from the buffer already in memory — no extra download needed.
    // Saved so the mobile app can verify the downloaded file is not corrupted.
    try {
      const staticFile = possibleFiles.find((f) => f.name === "sign_model_static.tflite");
      if (staticFile) {
        const staticResponse = await axios.get(staticFile.url, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        const checksumHex = crypto
          .createHash("sha256")
          .update(Buffer.from(staticResponse.data))
          .digest("hex");
        await model.update({ checksum: checksumHex });
        console.log(`SHA256 checksum saved: ${checksumHex}`);
      }
    } catch (csErr) {
      console.warn("Checksum computation failed (non-fatal):", csErr.message);
    }

    // If the model is already deployed (e.g., stuck from a previous partial failure), skip ML call.
    const alreadyDeployed = model.status === "deployed";
    if (!alreadyDeployed) {
      // Call FastAPI ML microservice to finalize deployment
      try {
        await axios.post(`${ML_SERVICE_URL}/deploy`, {
          version_number: model.version_number,
          model_id: model.id,
          tflite_url: model.tflite_url,
        }, { headers: { "ngrok-skip-browser-warning": "1" } });
      } catch (mlErr) {
        if (mlErr.response) {
          const detail =
            mlErr.response.data?.detail ||
            mlErr.response.data?.message ||
            mlErr.message;
          console.error("ML service deploy error:", detail);
          return res.status(mlErr.response.status).json({ message: detail });
        }
        console.error("ML service unreachable:", mlErr.message);
        return res.status(503).json({
          message: "ML service unavailable. Make sure sigla-ml is running.",
        });
      }

      // Set all other deployed models to inactive, then deploy this one
      await ModelVersion.update(
        { status: "inactive" },
        { where: { status: "deployed" } },
      );
      await model.update({ status: "deployed", deployed_at: new Date() });
    }

    // ── Activate approved words ──────────────────────────────────────────────
    // Wrapped in try/catch — failure here must never leave the model stuck.
    let wordsToActivate = [];
    try {
      wordsToActivate = await Word.findAll({
        where: { status: "approved", is_active: false },
      });

      for (const word of wordsToActivate) {
        await word.update({ is_active: true });
      }
    } catch (wordErr) {
      console.error("Word activation error (non-fatal):", wordErr.message);
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    try {
      const activeUsers = await User.findAll({
        where: { status: "active", role_id: 3 },
        attributes: ["id"],
      });

      const newWordLabels = wordsToActivate.map((w) => w.label);
      const wordNote =
        newWordLabels.length > 0
          ? ` ${newWordLabels.length} new word(s) added: ${newWordLabels.slice(0, 5).join(", ")}${newWordLabels.length > 5 ? "…" : ""}.`
          : "";

      const notifications = activeUsers.map((u) => ({
        user_id: u.id,
        title: "New Model Available",
        message: `A new sign language model (${model.version_number}) has been deployed.${wordNote} Update your app to get the latest improvements.`,
        type: "model_updated",
      }));

      if (notifications.length > 0)
        await Notification.bulkCreate(notifications);
    } catch (notifErr) {
      console.error("Notification error (non-fatal):", notifErr.message);
    }

    // Log activity
    // try {
    //   await ActivityLog.create({
    //     user_id: req.user.id,
    //     action: "deployed_model",
    //     target_type: "model",
    //     target_id: model.id,
    //     details: `Deployed model version ${model.version_number}`,
    //   });
    // } catch (_) {}

    return res.status(200).json({
      message: `Model ${model.version_number} deployed successfully`,
      model,
    });
  } catch (err) {
    console.error("Deploy model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/models/revert ───────────────────────────────────
// Admin reverts to a previous model version
const revertModel = async (req, res) => {
  try {
    const { model_id } = req.body;

    if (!model_id) {
      return res.status(400).json({ message: "Model ID is required" });
    }

    const model = await ModelVersion.findOne({ where: { id: model_id } });

    if (!model) {
      return res.status(404).json({ message: "Model not found" });
    }

    if (model.status === "deployed") {
      return res.status(400).json({ message: "Model is already deployed" });
    }

    if (!model.tflite_url) {
      return res.status(400).json({
        message:
          "This model version has no .tflite file and cannot be reverted to.",
      });
    }

    // Set all currently deployed models to inactive
    await ModelVersion.update(
      { status: "inactive" },
      { where: { status: "deployed" } },
    );

    // Set selected model as deployed
    await model.update({
      status: "deployed",
      deployed_at: new Date(),
    });

    // Log activity
    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "reverted_model",
    //   target_type: "model",
    //   target_id: model.id,
    //   details: `Reverted to model version ${model.version_number}`,
    // });

    return res.status(200).json({
      message: `Reverted to model version ${model.version_number} successfully`,
      model,
    });
  } catch (err) {
    console.error("Revert model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/models/:id ────────────────────────────────────
// Admin deletes a model version (only inactive or trained)
const deleteModel = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({ where: { id: req.params.id } });

    if (!model) {
      return res.status(404).json({ message: "Model not found" });
    }

    if (model.status === "deployed") {
      return res.status(400).json({
        message:
          "Cannot delete a deployed model. Revert to another version first.",
      });
    }

    // Log before deleting
    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "deleted_model",
    //   target_type: "model",
    //   target_id: model.id,
    //   details: `Deleted model version ${model.version_number}`,
    // });

    await model.destroy();

    return res.status(200).json({ message: "Model deleted successfully" });
  } catch (err) {
    console.error("Delete model error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllModels,
  getModelStats,
  getLatestModel,
  getModelById,
  trainModel,
  getModelStatus,
  testModel,
  deployModel,
  revertModel,
  deleteModel,
};
