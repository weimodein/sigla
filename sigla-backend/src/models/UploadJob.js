const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

// A batch of dataset clips moving through landmark extraction.
//
// uploadVideos creates the row, returns 202, then advances it from a background
// loop. The row is the source of truth for progress, which is what lets the admin
// close the upload modal, navigate away, or reload without losing the batch.
//
// Requires a manual migration — this project has no migration tooling and never
// calls sequelize.sync(). See migrations/003_upload_jobs.sql.
const UploadJob = sequelize.define(
  "UploadJob",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    word_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    started_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Carried through to each gesture_samples row for signer-grouped
    // cross-validation. See migrations/002_gesture_samples_session_id.sql.
    session_id: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // "failed" means the batch broke (ML service unreachable, DB error). Clips
    // that individually skip or fail are recorded in `results` and still leave the
    // job at "completed" — a partly-failed batch is a normal outcome, not an error.
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "processing",
      validate: {
        isIn: [["processing", "completed", "failed"]],
      },
    },
    total_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // Advanced after each clip so the client's progress bar reflects real work
    // rather than interpolating between "sent" and "done".
    processed_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    success_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    fail_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // The array extractAndStoreSample returns, one entry per clip:
    // { file, status: "ok"|"skipped"|"failed", type, sample_id?, reason?, error? }
    results: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "upload_jobs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = UploadJob;
