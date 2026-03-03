const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Report = sequelize.define(
  "Report",
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
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: "open",
      validate: {
        isIn: [["open", "resolved", "dismissed"]],
      },
    },
    resolved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "reports",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = Report;
