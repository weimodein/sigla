const { Op } = require("sequelize");
const axios = require("axios");
const {
  ModelVersion,
  User,
  ActivityLog,
  Notification,
} = require("../models/index.js");
require("dotenv").config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// ── GET /api/models ───────────────────────────────────────────
// Get all model versions
const getAllModels = async (req, res) => {
  try {
    const models = await ModelVersion.findAll({
      include: [
        { model: User, as: "trainer", attributes: ["id", "username", "name"] },
      ],
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
// Mobile app: get the latest deployed model info
const getLatestModel = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({
      where: { status: "deployed" },
      attributes: [
        "id",
        "version_number",
        "tflite_url",
        "accuracy",
        "deployed_at",
        "total_classes",
      ],
      order: [["deployed_at", "DESC"]],
    });

    if (!model) {
      return res.status(404).json({ message: "No deployed model found" });
    }

    return res.status(200).json({ model });
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
      include: [
        { model: User, as: "trainer", attributes: ["id", "username", "name"] },
      ],
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
      // If ML service is unreachable, delete the record and return error
      await modelRecord.destroy();
      console.error("ML service error:", mlErr.message);
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
      console.error("ML service error:", mlErr.message);
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

    if (model.status === "deployed") {
      return res.status(400).json({ message: "Model is already deployed" });
    }

    if (!model.tflite_url) {
      return res.status(400).json({
        message: "Model has no .tflite file. Train the model first.",
      });
    }

    // Call FastAPI ML microservice to finalize deployment
    try {
      await axios.post(`${ML_SERVICE_URL}/deploy`, {
        version_number: model.version_number,
        model_id: model.id,
        tflite_url: model.tflite_url,
      });
    } catch (mlErr) {
      console.error("ML service error:", mlErr.message);
      return res.status(503).json({
        message: "ML service unavailable. Make sure sigla-ml is running.",
      });
    }

    // Set all other deployed models to inactive
    await ModelVersion.update(
      { status: "inactive" },
      { where: { status: "deployed" } },
    );

    // Deploy this model
    await model.update({
      status: "deployed",
      deployed_at: new Date(),
    });

    // Notify all active users about the new model
    const { User: UserModel } = require("../models/index.js");
    const activeUsers = await UserModel.findAll({
      where: { status: "active", role_id: 3 },
      attributes: ["id"],
    });

    const notifications = activeUsers.map((u) => ({
      user_id: u.id,
      title: "New Model Available",
      message: `A new sign language model (${model.version_number}) has been deployed. Update your app to get the latest translation improvements.`,
      type: "model_updated",
    }));

    if (notifications.length > 0) {
      const { Notification: NotifModel } = require("../models/index.js");
      await NotifModel.bulkCreate(notifications);
    }

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deployed_model",
      target_type: "model",
      target_id: model.id,
      details: `Deployed model version ${model.version_number}`,
    });

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
