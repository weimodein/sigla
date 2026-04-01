const { Op } = require("sequelize");
const axios = require("axios");
const {
  ModelVersion,
  Word,
  WordBank,
  User,
  ActivityLog,
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
        "word_bank_url",
        "accuracy",
        "deployed_at",
        "total_classes",
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
// Admin triggers model training via FastAPI ML microservice
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

    // Create a model version record with status "training"
    const modelRecord = await ModelVersion.create({
      version_number,
      notes: notes || null,
      trained_by: req.user.id,
      status: "trained",
    });

    // Call FastAPI ML microservice to start training
    let trainingResult;
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/train`, {
        version_number,
        model_id: modelRecord.id,
      });
      trainingResult = response.data;
    } catch (mlErr) {
      await modelRecord.destroy();
      if (mlErr.response) {
        // ML service responded with an error (4xx/5xx) — show the real message
        const detail =
          mlErr.response.data?.detail ||
          mlErr.response.data?.message ||
          mlErr.message;
        console.error("ML service training error:", detail);
        return res.status(mlErr.response.status).json({ message: detail });
      }
      // Network error — service is unreachable
      console.error("ML service unreachable:", mlErr.message);
      return res.status(503).json({
        message: "ML service unavailable. Make sure sigla-ml is running.",
      });
    }

    // Update model record with training results from FastAPI
    await modelRecord.update({
      accuracy: trainingResult.accuracy || null,
      precision: trainingResult.precision || null,
      recall: trainingResult.recall || null,
      f1_score: trainingResult.f1_score || null,
      total_classes: trainingResult.total_classes || null,
      tflite_url: trainingResult.tflite_url || null,
      h5_url: trainingResult.h5_url || null,
      trained_at: new Date(),
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "trained_model",
      target_type: "model",
      target_id: modelRecord.id,
      details: `Trained model version ${version_number}`,
    });

    return res.status(200).json({
      message: "Model trained successfully",
      model: modelRecord,
      training_result: trainingResult,
    });
  } catch (err) {
    console.error("Train model error:", err);
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
      });
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
      precision: testResult.precision || model.precision,
      recall: testResult.recall || model.recall,
      f1_score: testResult.f1_score || model.f1_score,
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "tested_model",
      target_type: "model",
      target_id: model.id,
      details: `Tested model version ${model.version_number}. Accuracy: ${testResult.accuracy}`,
    });

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

    // List of expected files – required ones must exist, optional ones are skipped if missing
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
        url: `${baseUrl}/sign_model_motion.tflite`,
        name: "sign_model_motion.tflite",
        required: false,
      },
      {
        url: `${baseUrl}/labels_motion.json`,
        name: "labels_motion.json",
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

    // If the model is already deployed (e.g., stuck from a previous partial failure), skip ML call.
    const alreadyDeployed = model.status === "deployed";
    if (!alreadyDeployed) {
      // Call FastAPI ML microservice to finalize deployment
      try {
        await axios.post(`${ML_SERVICE_URL}/deploy`, {
          version_number: model.version_number,
          model_id: model.id,
          tflite_url: model.tflite_url,
        });
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

    // ── Activate approved words + generate word_bank.json ────────────────────
    // Wrapped in try/catch — failure here must never leave the model stuck.
    let wordsToActivate = [];
    try {
      // Activate ALL approved words — the training pipeline is the quality gate,
      // not the sample count. Admin deployed this model, so all approved words are ready.
      wordsToActivate = await Word.findAll({
        where: { status: "approved", is_active: false },
      });

      for (const word of wordsToActivate) {
        await word.update({ is_active: true });
        const existing = await WordBank.findOne({
          where: { word_id: word.id },
        });
        if (!existing) {
          await WordBank.create({
            word_id: word.id,
            label: word.label,
            description: word.description,
            sign_type: word.sign_type,
            category: word.category,
            hands_count: word.hands_count,
            gesture_type: word.gesture_type,
            is_active: true,
            video_url: word.video_url || null,
            image_url: word.thumbnail_url || null,
            filipino_translation: word.filipino_translation || null,
          });
        } else {
          await existing.update({
            is_active: true,
            gesture_type: word.gesture_type,
            filipino_translation:
              word.filipino_translation || existing.filipino_translation,
            image_url: word.thumbnail_url || existing.image_url,
            video_url: word.video_url || existing.video_url,
          });
        }
      }
    } catch (wordErr) {
      console.error("Word activation error (non-fatal):", wordErr.message);
    }

    // ── Generate and upload word_bank.json to Supabase ───────────────────────
    try {
      const allActiveWords = await WordBank.findAll({
        where: { is_active: true },
      });
      const wordBankPayload = {
        version: model.version_number,
        deployed_at: new Date().toISOString(),
        words: allActiveWords.map((w) => ({
          id: w.id,
          label: w.label,
          description: w.description || null,
          sign_type: w.sign_type,
          category: w.category,
          hands_count: w.hands_count,
          gesture_type: w.gesture_type || "static",
          thumbnail_url: w.image_url || null,
          video_url: w.video_url || null,
          filipino_translation: w.filipino_translation || null,
        })),
      };

      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const jsonBuffer = Buffer.from(
          JSON.stringify(wordBankPayload),
          "utf-8",
        );
        const wordBankUrl = await uploadToSupabase(
          "deployed/word_bank.json",
          jsonBuffer,
          "application/json",
        );
        await model.update({ word_bank_url: wordBankUrl });
        console.log(`Word bank JSON uploaded: ${allActiveWords.length} words`);
      }
    } catch (wbErr) {
      console.error("Word bank upload error (non-fatal):", wbErr.message);
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
    try {
      await ActivityLog.create({
        user_id: req.user.id,
        action: "deployed_model",
        target_type: "model",
        target_id: model.id,
        details: `Deployed model version ${model.version_number}`,
      });
    } catch (_) {}

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
    await ActivityLog.create({
      user_id: req.user.id,
      action: "reverted_model",
      target_type: "model",
      target_id: model.id,
      details: `Reverted to model version ${model.version_number}`,
    });

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
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deleted_model",
      target_type: "model",
      target_id: model.id,
      details: `Deleted model version ${model.version_number}`,
    });

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
  testModel,
  deployModel,
  revertModel,
  deleteModel,
};
