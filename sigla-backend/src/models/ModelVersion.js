const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const ModelVersion = sequelize.define(
  "ModelVersion",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    version_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    tflite_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    h5_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    accuracy: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    total_classes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    trained_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    trained_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deployed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "trained",
      validate: {
        isIn: [["training", "trained", "deployed", "inactive", "failed"]],
      },
    },
    training_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    checksum: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "model_versions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = ModelVersion;
