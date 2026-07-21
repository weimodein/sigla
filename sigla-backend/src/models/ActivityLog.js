const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

// Append-only audit trail of significant admin actions.
// Records are never updated or deleted (no updatedAt) to preserve the trail.
const ActivityLog = sequelize.define(
  "ActivityLog",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // The administrator who performed the action. Nullable so the trail
    // survives even if the actor account is later deleted.
    administrator_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Machine-readable action key, e.g. "deployed_model", "created_admin".
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    // The kind of item affected: "word", "model", "user", etc.
    target_type: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    // Id of the affected item within its target_type.
    target_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Human-readable description of what happened.
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "activity_logs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = ActivityLog;
