const { Op } = require("sequelize");
const axios = require("axios");
const crypto = require("crypto");
const {
  ModelVersion,
  Word,
  Administrator,
  GestureSample,
} = require("../models/index.js");
const { logActivity } = require("../utils/activityLogger.js");
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

// Sequelize `where` fragment restricting Word to one kind's vocabulary.
// Returned as a fragment rather than an id list so callers can spread it into a
// larger where clause without a second query.
async function wordIdScopeForKind(kind) {
  // Reads the column directly rather than fetching every row to classify it.
  // With no letters recorded this matches nothing for 'letters' and every row
  // for 'words' — exactly the pre-split behaviour.
  return { vocabulary: kind };
}

// ── Make Word.is_active match the deployed version ───────────
// is_active was a one-way latch: deploy set it true and nothing ever set it
// back, so every word ever deployed stayed visible and a revert never shrank the
// word bank. Reconciling both directions keeps the admin "Active" count honest
// and keeps the /word-bank fallback correct for rows with no trained_word_ids.
//
// A version with no recorded class list (trained before that column existed)
// tells us nothing — skip rather than deactivating everything.
async function reconcileActiveWords(model) {
  const ids = Array.isArray(model.trained_word_ids)
    ? model.trained_word_ids
    : null;

  if (!ids) {
    console.warn(
      `[reconcileActiveWords] version ${model.version_number} has no trained_word_ids — leaving is_active untouched`,
    );
    return;
  }

  // Each kind owns only its own slice of is_active.
  //
  // This used to deactivate every word outside the deploying model's class
  // list, which was right while one model covered the whole vocabulary. With a
  // words model and a letters model deployed together it becomes a fight:
  // deploying letters would deactivate all 50 words and deploying words would
  // deactivate all 26 letters, each one hiding the other's vocabulary from the
  // phone. Scoping the deactivation to the kind being deployed keeps a revert
  // shrinking the right word bank without touching the other.
  const kindScope = await wordIdScopeForKind(model.model_kind);

  // Both clauses below constrain `id`, and so does kindScope. They are combined
  // under Op.and rather than spread into one object: two `id` keys in the same
  // literal collide, and the later spread silently wins — which would drop the
  // class-list filter entirely and reconcile against the kind alone.
  if (ids.length > 0) {
    // Scoped by kind on the way IN as well, not just on the way out: a model
    // whose class list disagrees with its kind (a bad train request, a manually
    // edited row) would otherwise activate words belonging to the other model,
    // which then has no way to deactivate them again.
    await Word.update(
      { is_active: true },
      {
        where: {
          [Op.and]: [{ id: { [Op.in]: ids } }, kindScope],
          is_active: false,
        },
      },
    );
  }

  await Word.update(
    { is_active: false },
    {
      where: {
        is_active: true,
        [Op.and]: [
          kindScope,
          ...(ids.length > 0 ? [{ id: { [Op.notIn]: ids } }] : []),
        ],
      },
    },
  );
}

// ── Copy a model version's files into the fixed deployed/ folder + recompute its
// checksum. The mobile app always downloads from this fixed path regardless of which
// version is "active", and verifies it against the ModelVersion row's stored checksum
// — so both deployModel AND revertModel must call this. A status-only flip (no file
// copy) leaves the fixed path serving stale bytes that don't match the "new" active
// row's checksum, which makes the mobile app correctly refuse the download and keep
// running whatever was last downloaded, silently. Used by deployModel and revertModel.
async function syncModelFilesToDeployed(model) {
  if (!model.tflite_url) {
    throw new Error("Model has no .tflite file. Train the model first.");
  }

  // Derive base URL from the motion tflite file (all files share the same folder)
  const baseUrl = model.tflite_url.substring(0, model.tflite_url.lastIndexOf("/"));
  const files = [
    { url: model.tflite_url, name: "sign_model_motion.tflite", required: true },
    { url: `${baseUrl}/labels_motion.json`, name: "labels_motion.json", required: true },
  ];

  // A letters model deploys into its own folder. Both kinds previously wrote
  // deployed/sign_model_motion.tflite, so deploying one would overwrite the
  // other's bytes while leaving that other row's checksum pointing at what used
  // to be there — the app would then correctly refuse the download and silently
  // keep running whatever it had.
  //
  // 'words' keeps the original unprefixed path so already-installed apps, which
  // ask for deployed/ by that exact name, are unaffected by this change.
  const deployDir =
    model.model_kind === "letters" ? "deployed/letters" : "deployed";

  for (const file of files) {
    if (!file.url || file.url === "null") {
      if (file.required) throw new Error(`Missing URL for required file: ${file.name}`);
      console.warn(`Skipping optional file ${file.name} – no URL provided.`);
      continue;
    }

    const response = await axios.get(file.url, { responseType: "arraybuffer", timeout: 30000 });
    const buffer = Buffer.from(response.data);
    const contentType =
      response.headers["content-type"] ||
      (file.name.endsWith(".tflite") ? "application/octet-stream" : "application/json");
    await uploadToSupabase(`${deployDir}/${file.name}`, buffer, contentType);
    console.log(
      `Uploaded ${file.name} -> ${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_MODELS}/${deployDir}/${file.name}`,
    );

    if (file.name === "sign_model_motion.tflite") {
      const checksumHex = crypto.createHash("sha256").update(buffer).digest("hex");
      await model.update({ checksum: checksumHex });
      console.log(`SHA256 checksum saved: ${checksumHex}`);
    }
  }
}

// ── GET /api/models ───────────────────────────────────────────
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
    const [total, deployed, trained] = await Promise.all([
      ModelVersion.count(),
      ModelVersion.count({ where: { status: "deployed" } }),
      ModelVersion.count({ where: { status: "trained" } }),
    ]);

    // `deployed` may now be 2 — one words model and one alphabet model. The
    // dashboard's "current model" stays the WORDS one rather than whichever was
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

    // All file URLs point to a fixed folder in Supabase so the mobile app always
    // fetches from a stable path regardless of version. Every model is a motion
    // (LSTM) model; `letters` deploys to a subfolder so the two kinds do not
    // overwrite each other's bytes.
    const withUrls = (model) => {
      const dir = model.model_kind === "letters" ? "deployed/letters" : "deployed";
      const base = SUPABASE_URL
        ? `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_MODELS}/${dir}`
        : null;
      return {
        ...model.toJSON(),
        tflite_url: base ? `${base}/sign_model_motion.tflite` : model.tflite_url,
        labels_motion_url: base ? `${base}/labels_motion.json` : null,
      };
    };

    const words = deployed.find((m) => m.model_kind === "words") || null;
    const letters = deployed.find((m) => m.model_kind === "letters") || null;

    // `model` stays the WORDS model and keeps its exact former shape: installed
    // apps read that key and know nothing about kinds, so moving or renaming it
    // would break every phone in the field on the next update check. A 404 when
    // no words model is deployed is likewise what those apps already expect.
    if (!words) {
      return res.status(404).json({ message: "No deployed model found" });
    }

    return res.status(200).json({
      model: withUrls(words),
      // New clients read this instead and pick up the alphabet when one is
      // deployed. Absent letters, it carries only the words entry and the
      // response is equivalent to the old one.
      models: {
        words: withUrls(words),
        ...(letters ? { letters: withUrls(letters) } : {}),
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
// Every call into the ML service must use this, not model.version_number:
// train writes to it and deploy reads from it, so the two disagreeing means the
// deploy silently fetches the wrong model's files.
function mlVersionName(versionNumber, kind) {
  return kind === "letters" ? `${versionNumber}-letters` : versionNumber;
}

// ── Bring the other half of a version live alongside it ───────
//
// A version is a PAIR: the words model and the alphabet trained in the same
// run. Activating only the one the admin clicked would leave the phone with a
// words model from this version and an alphabet from whatever was live before
// — the drift that training them together exists to prevent. Used by BOTH
// deploy and revert, since reverting has exactly the same hazard in reverse.
//
// Non-fatal by design: the clicked model is already live and serving by the
// time this runs, so a companion that never trained, or fails to sync, must not
// turn a successful deploy into an error. Returns a note for the response, or
// "" when there was nothing to do.
async function deployCompanion(model) {
  try {
    const companion = await ModelVersion.findOne({
      where: {
        version_number: model.version_number,
        model_kind: model.model_kind === "letters" ? "words" : "letters",
        status: { [Op.ne]: "deployed" },
      },
    });
    if (!companion || !companion.tflite_url) return "";

    await syncModelFilesToDeployed(companion);
    await ModelVersion.update(
      { status: "inactive" },
      { where: { status: "deployed", model_kind: companion.model_kind } },
    );
    await companion.update({ status: "deployed", deployed_at: new Date() });
    if (!Array.isArray(companion.trained_word_ids)) {
      await companion.update({
        trained_word_ids: await getTrainedWordIds(companion.model_kind),
      });
    }
    await reconcileActiveWords(companion);
    console.log(
      `[models] also activated ${companion.model_kind} model for ${model.version_number}`,
    );
    return ` (with its ${companion.model_kind} model)`;
  } catch (companionErr) {
    console.error(
      "Companion model activation failed (non-fatal):",
      companionErr.message,
    );
    return "";
  }
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

    // Create record with status "training" — frontend polls this
    const modelRecord = await ModelVersion.create({
      version_number,
      notes: notes || null,
      trained_by: req.user.id,
      status: "training",
      model_kind: "words",
    });

    // The alphabet is trained in the SAME run, as a second row under the same
    // version. Training them separately let the two drift — a words model from
    // today against a letters model from last week, with nothing saying they
    // disagreed — and made the alphabet easy to forget entirely.
    //
    // Only when there are letters to train on. On a deployment with none, this
    // run produces exactly what it did before the split: one words model.
    const letterLabels = await labelsForKind("letters");
    const lettersRecord = letterLabels.length > 0
      ? await ModelVersion.create({
          version_number,
          notes: notes || null,
          trained_by: req.user.id,
          status: "training",
          model_kind: "letters",
        })
      : null;

    // Respond immediately — do NOT await training
    res.status(202).json({
      message: "Training started. Poll /api/models/:id/status for progress.",
      // The words row. Stays the top-level `model` because that is what the
      // caller polls and what every pre-split client reads.
      model: modelRecord,
      // The alphabet trained in the same run, or null when there are no letters
      // to train. Returned so the caller can poll it too and report a partial
      // outcome — a failed alphabet is otherwise invisible until someone
      // notices a "failed" row in the table.
      letters_model: lettersRecord,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "trained_model",
      target_type: "model",
      target_id: modelRecord.id,
      details: `Started training model version ${version_number}`,
    });

    // ── Background training job ───────────────────────────────
    (async () => {
      // Words first, then the alphabet.
      //
      // The order is not arbitrary. The words model is the expensive one (50
      // classes over ~1800 samples, tens of minutes) and the alphabet is small,
      // so running words first means a letters failure cannot waste it — the
      // words model is already recorded as trained and deployable by the time
      // the alphabet starts.
      await runTraining(modelRecord, version_number, "words");

      if (lettersRecord) {
        // Deliberately not awaited inside the same try as the words model: a
        // failed alphabet must leave the words model trained and usable, not
        // drag the whole version down with it. runTraining records the failure
        // on the letters row, where the admin can see it and retry.
        await runTraining(lettersRecord, version_number, "letters");
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

    // Copy this version's files into deployed/ and recompute its checksum.
    await syncModelFilesToDeployed(model);

    // If the model is already deployed (e.g., stuck from a previous partial failure), skip ML call.
    const alreadyDeployed = model.status === "deployed";
    if (!alreadyDeployed) {
      // Call FastAPI ML microservice to finalize deployment
      try {
        await axios.post(`${ML_SERVICE_URL}/deploy`, {
          // Must match what training wrote, NOT model.version_number: the
          // alphabet's artifacts live under a suffixed directory, so sending
          // the bare version here made the deploy read the words model's files.
          version_number: mlVersionName(model.version_number, model.model_kind),
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

      // Retire the other deployed model OF THIS KIND, then deploy this one.
      // Unscoped, deploying the alphabet would retire the words model and leave
      // the phone with no vocabulary at all.
      await ModelVersion.update(
        { status: "inactive" },
        { where: { status: "deployed", model_kind: model.model_kind } },
      );
      await model.update({ status: "deployed", deployed_at: new Date() });
    }

    // ── Make the visible word bank match this version ────────────────────────
    // Words this version was trained on become visible; words it was not trained
    // on are hidden. Backfill trained_word_ids for versions trained before that
    // column existed, so this deploy — and any later revert to it — has a class
    // list to work from.
    // Wrapped in try/catch — failure here must never leave the model stuck.
    try {
      if (!Array.isArray(model.trained_word_ids)) {
        await model.update({
          trained_word_ids: await getTrainedWordIds(model.model_kind),
        });
      }
      await reconcileActiveWords(model);
    } catch (wordErr) {
      console.error("Word activation error (non-fatal):", wordErr.message);
    }

    const companionNote = await deployCompanion(model);

    // Log activity
    await logActivity({
      administrator_id: req.user.id,
      action: "deployed_model",
      target_type: "model",
      target_id: model.id,
      details: `Deployed model version ${model.version_number}${companionNote}`,
    });

    return res.status(200).json({
      message: `Model ${model.version_number} deployed successfully${companionNote}`,
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

    // Copy this version's files into deployed/ and recompute its checksum. Without
    // this, the fixed deployed/ path keeps serving the previously-active version's
    // bytes while this row's stale checksum no longer matches them — the mobile app's
    // integrity check then correctly rejects the download and silently keeps running
    // whatever was last verified, so the "revert" never actually reaches the phone.
    await syncModelFilesToDeployed(model);

    // Retire the other deployed model of this kind only — reverting the words
    // model must not take the deployed alphabet down with it.
    await ModelVersion.update(
      { status: "inactive" },
      { where: { status: "deployed", model_kind: model.model_kind } },
    );

    // Set selected model as deployed
    await model.update({
      status: "deployed",
      deployed_at: new Date(),
    });

    // ── Roll the word bank back with the model ───────────────────────────────
    // Without this the revert only swapped the .tflite: words added by a newer
    // version stayed visible and the phone advertised words the restored model
    // cannot predict. A version with no recorded class list is left alone.
    try {
      await reconcileActiveWords(model);
    } catch (wordErr) {
      console.error("Word reconciliation error (non-fatal):", wordErr.message);
    }

    // Roll the other half of this version back too. Without it, reverting the
    // words model to an older version leaves the NEWER alphabet deployed beside
    // it — the two halves of a pair from different runs, which is exactly what
    // training them together is meant to rule out.
    const companionNote = await deployCompanion(model);

    // Log activity
    await logActivity({
      administrator_id: req.user.id,
      action: "reverted_model",
      target_type: "model",
      target_id: model.id,
      details: `Reverted to model version ${model.version_number}${companionNote}`,
    });

    return res.status(200).json({
      message: `Reverted to model version ${model.version_number} successfully${companionNote}`,
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

    const deletedModelId = model.id;
    const deletedModelVersion = model.version_number;

    // A version is a PAIR — the words model and the alphabet trained in the
    // same run — and they deploy together, so they delete together. Removing
    // only the clicked row would leave an orphan: a letters model whose words
    // half no longer exists, still listed and still deployable on its own.
    //
    // A DEPLOYED companion is left alone rather than deleted, for the same
    // reason the check above refuses a deployed model: taking it out from under
    // a running phone is not something a delete should do silently.
    const companion = await ModelVersion.findOne({
      where: {
        version_number: model.version_number,
        model_kind: model.model_kind === "letters" ? "words" : "letters",
      },
    });

    await model.destroy();

    let companionNote = "";
    if (companion) {
      if (companion.status === "deployed") {
        companionNote = ` (its ${companion.model_kind} model is deployed and was kept)`;
        console.warn(
          `[deleteModel] kept deployed ${companion.model_kind} model for ${deletedModelVersion}`,
        );
      } else {
        await companion.destroy();
        companionNote = ` (with its ${companion.model_kind} model)`;
      }
    }

    await logActivity({
      administrator_id: req.user.id,
      action: "deleted_model",
      target_type: "model",
      target_id: deletedModelId,
      details: `Deleted model version ${deletedModelVersion}${companionNote}`,
    });

    return res.status(200).json({
      message: `Model deleted successfully${companionNote}`,
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
