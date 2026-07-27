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
    // Array of frames, each frame an array of FEATURE_SIZE landmark coordinates.
    // Static gestures (from an image, or a video clip classified as a held pose —
    // see sigla-ml classify_motion_or_static) are stored as a length-1 array (a
    // single frame); motion gestures as the full extracted sequence. No separate
    // static/motion column — which one a sample is gets re-derived from this
    // array's own length/velocity at train time, not stored as a flag.
    sequence: {
      type: DataTypes.JSON,
      allowNull: true,
      comment:
        "Array of frames, each frame containing FEATURE_SIZE landmark coordinates. Length 1 = static (held pose), length >1 = motion.",
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
