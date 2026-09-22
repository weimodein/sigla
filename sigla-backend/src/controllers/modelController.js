const { Op } = require("sequelize");
const axios = require("axios");
const crypto = require("crypto");
const { sequelize } = require("../config/db.js");
const {
  ModelVersion,
  Word,
  Administrator,
  GestureSample,
} = require("../models/index.js");
const { logActivity } = require("../utils/activityLogger.js");
require("dotenv").config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// ── Supabase helper: upload buffer to storage ─────────────────
// ── Which words feed a training run ──────────────────────────
// The eligibility filter mirrors mlController.getApprovedDataset, so the set
// recorded here stays in lock-step with the classes the model actually learned
// (the same set labels_motion.json names).
//
// Called at TRAINING time and stored on the version row. It is deliberately not
// re-derived at deploy time: the dataset can change between training and deploy,
// and a reverted model must advertise the words it was trained on, not today's.
// `kind` restricts the result to one vocabulary. Without it this answers "every
// training-eligible word", which is only right for a model trained on
// everything — used as a letters model's class list it would claim the whole
// word bank, and reconcileActiveWords would then activate words inside the
// alphabet's slice. Omitted, it keeps the original whole-dataset behaviour.
async function getTrainedWordIds(kind = null) {
  const trainedSamples = await GestureSample.findAll({
    attributes: ["word_id"],
    where: {
      [Op.or]: [
        { status: "approved" },
        { status: "pending", is_validated: true },
      ],
    },
    include: [
      {
        model: Word,
        as: "word",
        attributes: [],
        required: true,
        where: {
          [Op.or]: [{ status: "approved" }, { is_active: true }],
          ...(kind ? { vocabulary: kind } : {}),
        },
      },
    ],
  });

  return [...new Set(trainedSamples.map((s) => s.word_id))];
}

// ── Which words belong to a model kind ───────────────────────
// A letters model covers the fingerspelling alphabet, a words model covers
// everything else, and Word.vocabulary says which — set when the word is
// created rather than inferred from its label.
//
// This used to match ^[A-Z]$. That is correct for the 26-letter English
// alphabet and wrong for FSL as it grows: the Filipino alphabet also has Ñ and
// NG, and "NG" is a single letter spelled with two characters, so it would have
// been trained as an ordinary word sitting right beside the vocabulary it is
// meant to be held apart from.

// Word ids for a list of labels, as reported by the ML service after training.
// A label with no matching row is dropped with a warning rather than failing the
// run: training has already succeeded and the model file exists, so refusing to
// record the version here would lose it entirely.
async function wordIdsForLabels(labels) {
  const rows = await Word.findAll({
    attributes: ["id", "label"],
    where: { label: { [Op.in]: labels } },
  });
  const byLabel = new Map(rows.map((w) => [w.label, w.id]));
  const missing = labels.filter((l) => !byLabel.has(l));
  if (missing.length > 0) {
    console.warn(
      `[trainModel] ${missing.length} trained label(s) have no Word row and are ` +
        `absent from trained_word_ids: ${missing.join(", ")}`,
    );
  }
  return labels.map((l) => byLabel.get(l)).filter((id) => id !== undefined);
}

// Training-eligible labels belonging to one kind, for the ML service's
// word_labels. Mirrors the eligibility rule in getTrainedWordIds — a word with
// no usable samples is not a class and must not be requested, or training warns
// about a label it cannot find.
async function labelsForKind(kind) {
  const words = await Word.findAll({
    attributes: ["label"],
    where: {
      vocabulary: kind,
      [Op.or]: [{ status: "approved" }, { is_active: true }],
    },
  });
  return words.map((w) => w.label);
}

// ── GET /api/models ───────────────────────────────────────────
class ModelVersionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function labelsUrlFor(model) {
  if (!model.tflite_url || !model.tflite_url.includes("/")) {
    throw new ModelVersionError(
      `${model.model_kind} model has no valid .tflite URL. Train it first.`,
    );
  }
  return `${model.tflite_url.slice(0, model.tflite_url.lastIndexOf("/"))}/labels_motion.json`;
}

function modelWithArtifactUrls(model) {
  return {
    ...model.toJSON(),
    labels_motion_url: labelsUrlFor(model),
  };
}

function requireCompletePair(rows, versionNumber) {
  const words = rows.find((row) => row.model_kind === "words");
  const letters = rows.find((row) => row.model_kind === "letters");
  if (!words || !letters) {
    const missing = words ? "letters" : "words";
    throw new ModelVersionError(
      `Version ${versionNumber} is incomplete: its ${missing} model is missing.`,
    );
  }
  return { words, letters };
}

function parseLabels(buffer, model) {
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ModelVersionError(
      `${model.model_kind} labels are not valid JSON.`,
    );
  }

  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ModelVersionError(
      `${model.model_kind} labels must be a JSON object keyed by class index.`,
    );
  }

  const labels = [];
  for (let index = 0; index < Object.keys(value).length; index += 1) {
    const label = value[String(index)];
    if (typeof label !== "string" || !label.trim()) {
      throw new ModelVersionError(
        `${model.model_kind} labels are missing class index ${index}.`,
      );
    }
    labels.push(label);
  }

  if (labels.length === 0) {
    throw new ModelVersionError(`${model.model_kind} labels are empty.`);
  }
  if (model.total_classes != null && labels.length !== model.total_classes) {
    throw new ModelVersionError(
      `${model.model_kind} label count (${labels.length}) does not match total_classes (${model.total_classes}).`,
    );
  }
  return labels;
}

async function validateModelArtifact(model) {
  if (!["trained", "inactive", "deployed"].includes(model.status)) {
    throw new ModelVersionError(
      `${model.model_kind} model is ${model.status}; both models must finish training before deployment.`,
    );
  }

  const labelsUrl = labelsUrlFor(model);
  let modelBuffer;
  let labelsBuffer;
  try {
    const [modelResponse, labelsResponse] = await Promise.all([
      axios.get(model.tflite_url, { responseType: "arraybuffer", timeout: 30000 }),
      axios.get(labelsUrl, { responseType: "arraybuffer", timeout: 30000 }),
    ]);
    modelBuffer = Buffer.from(modelResponse.data);
    labelsBuffer = Buffer.from(labelsResponse.data);
  } catch (error) {
    throw new ModelVersionError(
      `Could not read the immutable ${model.model_kind} model artifacts: ${error.message}`,
      502,
    );
  }

  if (modelBuffer.length === 0) {
    throw new ModelVersionError(`${model.model_kind} model file is empty.`);
  }

  const labels = parseLabels(labelsBuffer, model);
  const words = await Word.findAll({
    attributes: ["id", "label"],
    where: {
      label: { [Op.in]: labels },
      vocabulary: model.model_kind,
    },
  });
  const idsByLabel = new Map(words.map((word) => [word.label, word.id]));
  const missingLabels = labels.filter((label) => !idsByLabel.has(label));
  if (missingLabels.length > 0) {
    throw new ModelVersionError(
      `${model.model_kind} model contains labels not present in its vocabulary: ${missingLabels.join(", ")}`,
    );
  }

  return {
    id: model.id,
    checksum: crypto.createHash("sha256").update(modelBuffer).digest("hex"),
    trainedWordIds: labels.map((label) => idsByLabel.get(label)),
  };
}

async function activateVersion(versionNumber) {
  const candidates = await ModelVersion.findAll({
    where: { version_number: versionNumber },
  });
  const pair = requireCompletePair(candidates, versionNumber);
  const validated = await Promise.all([
    validateModelArtifact(pair.words),
    validateModelArtifact(pair.letters),
  ]);
  const validatedById = new Map(validated.map((item) => [item.id, item]));
  const targetIds = validated.map((item) => item.id);
  const activeWordIds = [...new Set(validated.flatMap((item) => item.trainedWordIds))];
  const deployedAt = new Date();

  await sequelize.transaction(async (transaction) => {
    // Serializes deployment attempts without adding another table. The lock is
    // released automatically on commit/rollback.
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext('sigla:model-version-deploy'))",
      { transaction },
    );

    const lockedRows = await ModelVersion.findAll({
      where: { version_number: versionNumber },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const lockedPair = requireCompletePair(lockedRows, versionNumber);
    for (const model of [lockedPair.words, lockedPair.letters]) {
      if (!["trained", "inactive", "deployed"].includes(model.status)) {
        throw new ModelVersionError(
          `${model.model_kind} model changed to ${model.status} during deployment.`,
          409,
        );
      }
    }

    await ModelVersion.update(
      { status: "inactive" },
      {
        where: { status: "deployed", id: { [Op.notIn]: targetIds } },
        transaction,
      },
    );

    for (const model of [lockedPair.words, lockedPair.letters]) {
      const artifact = validatedById.get(model.id);
      await model.update(
        {
          status: "deployed",
          deployed_at: deployedAt,
          checksum: artifact.checksum,
          trained_word_ids: artifact.trainedWordIds,
        },
        { transaction },
      );
    }

    await Word.update(
      { is_active: false },
      { where: { is_active: true }, transaction },
    );
    await Word.update(
      { is_active: true },
      { where: { id: { [Op.in]: activeWordIds } }, transaction },
    );
  });

  const deployed = await ModelVersion.findAll({
    where: { version_number: versionNumber },
    order: [["model_kind", "DESC"]],
  });
  return requireCompletePair(deployed, versionNumber);
}

async function logModelActivity(details) {
  try {
    await logActivity(details);
  } catch (error) {
    // Deployment has already committed. An audit logging outage must not make
    // the API claim that deployment failed and invite a duplicate retry.
    console.error("Model activity logging failed:", error.message);
  }
}

// Get all model versions
const getAllModels = async (req, res) => {
  try {
    const models = await ModelVersion.findAll({
      include: [{ model: Administrator, as: "trainer", attributes: ["id", "username"] }],
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
    // Counted per VERSION, not per row. A training run writes two rows — the
    // words model and the alphabet — under one version number, so raw row
    // counts told the admin there were 10 versions when 9 had been trained, and
    // that 2 models were deployed when one pair was. The pair is one thing to
    // deploy, revert and delete, so it is one thing to count.
    //
    // Scoped to the words row rather than counting DISTINCT version_number: an
    // alphabet row only exists alongside a words row, and a version whose words
    // half failed should not be reported as trained just because its alphabet
    // succeeded.
    const [total, deployed, trained] = await Promise.all([
      ModelVersion.count({ where: { model_kind: "words" } }),
      ModelVersion.count({ where: { status: "deployed", model_kind: "words" } }),
      ModelVersion.count({ where: { status: "trained", model_kind: "words" } }),
    ]);

    // The dashboard's "current model" is the WORDS one rather than whichever was
    // deployed most recently, which would otherwise flip to the alphabet the
    // moment it was deployed and report its much smaller class count as the
    // system's. The letters model is reported separately.
    const [deployedModel, deployedLetters] = await Promise.all([
      ModelVersion.findOne({
        where: { status: "deployed", model_kind: "words" },
        order: [["deployed_at", "DESC"]],
      }),
      ModelVersion.findOne({
        where: { status: "deployed", model_kind: "letters" },
        order: [["deployed_at", "DESC"]],
      }),
    ]);

    return res.status(200).json({
      total,
      deployed,
      trained,
      current_model: deployedModel || null,
      current_letters_model: deployedLetters || null,
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
    const deployed = await ModelVersion.findAll({
      where: { status: "deployed" },
      attributes: [
        "id",
        "version_number",
        "tflite_url",
        "accuracy",
        "deployed_at",
        "total_classes",
        "checksum",
        "model_kind",
      ],
      order: [["deployed_at", "DESC"]],
    });

    if (deployed.length === 0) {
      return res.status(404).json({ message: "No deployed model found" });
    }

    const wordsRows = deployed.filter((model) => model.model_kind === "words");
    const lettersRows = deployed.filter((model) => model.model_kind === "letters");
    const words = wordsRows[0] || null;
    const letters = lettersRows[0] || null;
    if (
      wordsRows.length !== 1 ||
      lettersRows.length !== 1 ||
      words.version_number !== letters.version_number
    ) {
      console.error(
        "Inconsistent deployed model pair:",
        deployed.map((model) => `${model.version_number}:${model.model_kind}`),
      );
      return res.status(503).json({
        message: "The deployed model pair is inconsistent. Please deploy a complete version.",
      });
    }

    return res.status(200).json({
      deployment_version: words.version_number,
      // Kept for older app builds. It is the same immutable words artifact
      // exposed under models.words.
      model: modelWithArtifactUrls(words),
      models: {
        words: modelWithArtifactUrls(words),
        letters: modelWithArtifactUrls(letters),
      },
    });
  } catch (err) {
    console.error("Get latest model error:", err);
    return res.status(err.status || 500).json({
      message: err.status ? err.message : "Server error",
    });
  }
};

// ── GET /api/models/:id ───────────────────────────────────────
// Get a single model version by ID
const getModelById = async (req, res) => {
  try {
    const model = await ModelVersion.findOne({
      where: { id: req.params.id },
      include: [{ model: Administrator, as: "trainer", attributes: ["id", "username"] }],
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

// Trains ONE model row and records the outcome on it.
//
// Extracted so the words model and the alphabet can run through identical
// logic in one request. Never throws: a failure is written to the row as
// status "failed" plus training_error, so one kind failing cannot abort the
// other or leave the caller's background task rejecting unhandled.
async function runTraining(record, version_number, kind) {
  try {
    // Both kinds send an explicit list. A words model must NOT fall back to
    // "no list": that means every approved class, which would pull the
    // alphabet back into the words model and undo the split. The one case
    // that still sends nothing is a words model on a deployment with no
    // letters recorded, where the list would be every class anyway — there
    // the null keeps the request byte-identical to a pre-split one.
    const wordLabels = await labelsForKind(kind);
    const sendLabels =
      kind === "letters" || (await labelsForKind("letters")).length > 0;

    const response = await axios.post(
      `${ML_SERVICE_URL}/train`,
      {
        // See mlVersionName: the ML service keys its storage directory off
        // this, so the alphabet needs a name of its own.
        version_number: mlVersionName(version_number, kind),
        model_id: record.id,
        ...(sendLabels ? { word_labels: wordLabels } : {}),
      },
      {
        // TensorFlow training can exceed 20 minutes, especially now that the
        // deployment model is refit on the complete dataset. Axios interprets
        // zero as no client-side timeout; the job remains tracked through the
        // model row and the admin continues polling its status.
        timeout: 0,
        headers: { "ngrok-skip-browser-warning": "1" },
      },
    );
    const r = response.data;

    // Capture the class list NOW, while it is still true. Deriving it later
    // at deploy time would read a dataset that may have gained or lost
    // samples since, so a reverted model would advertise words it was never
    // trained on. This is the set labels_motion.json names.
    //
    // Prefer the labels the ML service reports over re-deriving them here.
    // getTrainedWordIds() answers "every training-eligible word", which is
    // only the same thing for a model trained on everything — a
    // subset-trained model would be credited with the whole vocabulary and
    // would then hide or show words it never saw. The fallback keeps
    // working against an ML service that predates trained_labels.
    const trainedLabels = r.trained_labels;
    const trainedWordIds = Array.isArray(trainedLabels)
      ? await wordIdsForLabels(trainedLabels)
      : await getTrainedWordIds(record.model_kind);

    await record.update({
      status:            "trained",
      accuracy:          r.accuracy           || null,
      total_classes:     r.total_classes       || null,
      tflite_url:        r.tflite_url          || null,
      h5_url:            r.h5_url              || null,
      trained_at:        new Date(),
      training_error:    null,
      trained_word_ids:  trainedWordIds,
    });
    console.log(`[trainModel] version ${version_number} (${kind}) training complete`);
    return true;
  } catch (mlErr) {
    const detail =
      mlErr.response?.data?.detail ||
      mlErr.response?.data?.message ||
      mlErr.message ||
      "Unknown training error";
    console.error(`[trainModel] background training failed (${kind}): ${detail}`);
    await record
      .update({ status: "failed", training_error: detail })
      .catch(() => {});
    return false;
  }
}

// The name the ML service stores a version's artifacts under.
//
// Both kinds of a version share a version_number in the database, but the ML
// service keys its storage directory off this string — so the alphabet needs a
// distinct one or it would overwrite the words model's .tflite and labels, and
// a later deploy would read whichever landed last.
//
// Training must use this rather than the shared database version_number so the
// two immutable artifact folders cannot overwrite one another.
function mlVersionName(versionNumber, kind) {
  return kind === "letters" ? `${versionNumber}-letters` : versionNumber;
}

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

    // Check if version number already exists.
    //
    // A version now names a PAIR of rows (words + letters), so this checks the
    // words row specifically rather than any row with the number: the letters
    // row legitimately shares it.
    const existing = await ModelVersion.findOne({
      where: { version_number, model_kind: "words" },
    });
    if (existing) {
      return res.status(409).json({ message: "Version number already exists" });
    }

    const letterLabels = await labelsForKind("letters");
    if (letterLabels.length === 0) {
      return res.status(400).json({
        message:
          "No trainable letters were found. Add approved letter samples before training a paired version.",
      });
    }

    // A version begins as a complete pair. Creating both rows in one database
    // transaction prevents an orphaned words row if the second insert fails.
    const { modelRecord, lettersRecord } = await sequelize.transaction(
      async (transaction) => {
        const words = await ModelVersion.create({
          version_number,
          notes: notes || null,
          trained_by: req.user.id,
          status: "training",
          model_kind: "words",
        }, { transaction });
        const letters = await ModelVersion.create({
          version_number,
          notes: notes || null,
          trained_by: req.user.id,
          status: "training",
          model_kind: "letters",
        }, { transaction });
        return { modelRecord: words, lettersRecord: letters };
      },
    );

    // Respond immediately — do NOT await training
    res.status(202).json({
      message: "Training started. Poll /api/models/:id/status for progress.",
      // The words row. Stays the top-level `model` because that is what the
      // caller polls and what every pre-split client reads.
      model: modelRecord,
      // The required alphabet row from the same version, returned so the caller
      // can poll both halves and keep the version incomplete if either fails.
      letters_model: lettersRecord,
    });

    await logModelActivity({
      administrator_id: req.user.id,
      action: "trained_model",
      target_type: "model",
      target_id: modelRecord.id,
      details:
        `Started training model version ${version_number}` +
        " (words + alphabet)",
    });

    // ── Background training job ───────────────────────────────
    (async () => {
      // Words first, then the alphabet.
      //
      // The order is not arbitrary. The words model is the expensive one (50
      // classes over ~1800 samples, tens of minutes) and the alphabet is small,
      // so running words first records its result before the smaller alphabet
      // starts. The version is deployable only after both rows are trained.
      await runTraining(modelRecord, version_number, "words");

      await runTraining(lettersRecord, version_number, "letters");
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
      include: [{ model: Administrator, as: "trainer", attributes: ["id", "username"] }],
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
        // Same reason as deploy: the alphabet's artifacts live under a suffixed
        // directory, so the bare version would test the words model's files.
        version_number: mlVersionName(model.version_number, model.model_kind),
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
    await logActivity({
      administrator_id: req.user.id,
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
    let versionNumber = req.body.version_number;
    let requestedModel = null;
    if (!versionNumber && req.body.model_id) {
      requestedModel = await ModelVersion.findByPk(req.body.model_id);
      versionNumber = requestedModel?.version_number;
    }
    if (!versionNumber) {
      return res.status(requestedModel === null && req.body.model_id ? 404 : 400).json({
        message: req.body.model_id ? "Model not found" : "Version number is required",
      });
    }

    const pair = await activateVersion(versionNumber);

    await logModelActivity({
      administrator_id: req.user.id,
      action: "deployed_model",
      target_type: "model",
      target_id: pair.words.id,
      details: `Deployed complete model version ${versionNumber} (words + alphabet)`,
    });

    return res.status(200).json({
      message: `Model version ${versionNumber} deployed successfully (words + alphabet)`,
      deployment_version: versionNumber,
      models: {
        words: pair.words,
        letters: pair.letters,
      },
    });
  } catch (err) {
    console.error("Deploy model error:", err);
    return res.status(err.status || 500).json({
      message: err.status ? err.message : "Server error",
    });
  }
};

// ── POST /api/models/revert ───────────────────────────────────
// Admin reverts to a previous model version
const revertModel = async (req, res) => {
  try {
    let versionNumber = req.body.version_number;
    let requestedModel = null;
    if (!versionNumber && req.body.model_id) {
      requestedModel = await ModelVersion.findByPk(req.body.model_id);
      versionNumber = requestedModel?.version_number;
    }
    if (!versionNumber) {
      return res.status(requestedModel === null && req.body.model_id ? 404 : 400).json({
        message: req.body.model_id ? "Model not found" : "Version number is required",
      });
    }

    const pair = await activateVersion(versionNumber);

    await logModelActivity({
      administrator_id: req.user.id,
      action: "reverted_model",
      target_type: "model",
      target_id: pair.words.id,
      details: `Reverted to complete model version ${versionNumber} (words + alphabet)`,
    });

    return res.status(200).json({
      message: `Reverted to model version ${versionNumber} successfully (words + alphabet)`,
      deployment_version: versionNumber,
      models: {
        words: pair.words,
        letters: pair.letters,
      },
    });
  } catch (err) {
    console.error("Revert model error:", err);
    return res.status(err.status || 500).json({
      message: err.status ? err.message : "Server error",
    });
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

    const versionRows = await ModelVersion.findAll({
      where: { version_number: model.version_number },
    });
    if (versionRows.some((row) => row.status === "deployed")) {
      return res.status(400).json({
        message:
          "Cannot delete a deployed model version. Deploy another version first.",
      });
    }

    const deletedModelId = model.id;
    const deletedModelVersion = model.version_number;

    await sequelize.transaction(async (transaction) => {
      await ModelVersion.destroy({
        where: { version_number: deletedModelVersion },
        transaction,
      });
    });

    await logModelActivity({
      administrator_id: req.user.id,
      action: "deleted_model",
      target_type: "model",
      target_id: deletedModelId,
      details: `Deleted model version ${deletedModelVersion} (all model kinds)`,
    });

    return res.status(200).json({
      message: "Model version deleted successfully",
    });
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
