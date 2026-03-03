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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    hands_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: { isIn: [[1, 2]] },
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
    reviewed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reviewed_at: {
      type: DataTypes.DATE,
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
