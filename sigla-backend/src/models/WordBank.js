const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const WordBank = sequelize.define(
  "WordBank",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    word_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    label: {
      type: DataTypes.STRING(100),
      allowNull: false,
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
    image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    audio_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    hands_count: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    // Auto-generated demonstration video compiled from approved gesture samples
    video_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "word_bank",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = WordBank;
