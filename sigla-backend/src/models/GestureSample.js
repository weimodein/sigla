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
    submitted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    file_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    sample_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
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
