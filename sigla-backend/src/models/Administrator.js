const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Administrator = sequelize.define(
  "Administrator",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    role_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    // Nullable: administrators are created with a username + password only and
    // link their email later on first login.
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
      validate: { isEmail: true },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    // Default is now "active" — email is verified before account is created
    // so no pending approval step is needed
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "active",
      validate: {
        isIn: [["active", "deactivated", "deleted"]],
      },
    },
    warning_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    deactivated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // ── Login lockout (scope §13) ──
    // Consecutive failed attempts since the last successful login / reset.
    failed_login_attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // When the current temporary lock expires (null = not locked).
    lockout_until: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // How many times the account has been locked in the current failure streak;
    // drives the incrementing cooldown (5 * lockout_count minutes).
    lockout_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // Forced first-login onboarding (scope §10): new admins must link a verified
    // email and change their initial username/password before using the platform.
    // Defaults true so admin-created accounts require setup; existing/seeded
    // accounts are set false via migration.
    must_complete_setup: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "administrators",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = Administrator;
