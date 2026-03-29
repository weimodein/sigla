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
    // Supabase Storage URL of the gesture image
    file_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Supabase Storage URL of the extracted landmark JSON file
    landmark_url: {
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
  },
  {
    tableName: "gesture_samples",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = GestureSample;
