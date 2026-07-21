const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const GestureSample = sequelize.define(
  "GestureSample",
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
    // NULL when the submitting user account has been permanently deleted
    // ON DELETE SET NULL preserves the sample for dataset integrity
    submitted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Supabase Storage URL of the gesture image (optional when landmark data is sent directly)
    file_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Number of images in this submission batch
    sample_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // Whether MediaPipe validation passed during collection
    is_validated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Admin review result — pending until reviewed
    status: {
      type: DataTypes.STRING(20),
      defaultValue: "pending",
      validate: {
        isIn: [["pending", "approved", "rejected"]],
      },
    },
    // Every gesture is motion: array of frames, each frame array of landmark coords

    sequence: {
      type: DataTypes.JSON,
      allowNull: true,
      comment:
        "Array of frames, each frame containing 126 landmark coordinates for motion gestures",
    },
  },
  {
    tableName: "gesture_samples",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = GestureSample;
