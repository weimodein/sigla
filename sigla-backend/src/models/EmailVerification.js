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
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [["registration", "password_reset"]],
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
  },
  {
    tableName: "email_verifications",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = EmailVerification;
