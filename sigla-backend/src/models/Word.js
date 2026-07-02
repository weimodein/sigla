const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Word = sequelize.define(
  "Word",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    submitted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    label: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    // Lowercase + punctuation-stripped version of label for duplicate detection
    normalized_label: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sign_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: { isIn: [["FSL"]] },
    },
    category: {
      type: DataTypes.STRING(50),
      defaultValue: "additional words",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "pending",
      validate: {
        isIn: [["pending", "approved", "rejected"]],
      },
    },
    total_samples: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // Number of samples currently marked as approved
    approved_sample_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    reviewed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // When true the word is ready for translation in the mobile app
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // When true no new gesture sample submissions are accepted for this word
    is_locked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Admin-defined cap on total gesture samples collected across all users.
    // When null, falls back to the default cap (25).
    sample_limit: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    // Filipino translation of the word/phrase
    filipino_translation: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    // Admin-selected thumbnail image shown in the mobile word bank (static words)
    thumbnail_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // URL of the demonstration video shown in the mobile word bank (motion words)
    video_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "words",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = Word;
