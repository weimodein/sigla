const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Dictionary = sequelize.define(
  "Dictionary",
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
      validate: { isIn: [["FSL", "ASL"]] },
    },
    category: {
      type: DataTypes.STRING(20),
      defaultValue: "word",
      validate: { isIn: [["word", "alphabet"]] },
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
  },
  {
    tableName: "dictionary",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = Dictionary;
