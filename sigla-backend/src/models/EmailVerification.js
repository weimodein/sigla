const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const EmailVerification = sequelize.define(
  "EmailVerification",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    administrator_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [["registration", "password_reset", "email_change"]],
      },
    },
    is_used: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    // Tracks how many wrong codes were entered — session expires after 5
    attempt_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // Set to true when attempt_count hits 5 or a new code is requested
    session_invalidated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Used to enforce the 1-minute resend cooldown
    last_sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "email_verifications",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = EmailVerification;
