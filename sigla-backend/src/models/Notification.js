const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(30),
      defaultValue: "general",
      validate: {
        isIn: [
          [
            "general",
            "announcement",
            "warning",
            "submission_result",
            "word_approved",
            "word_rejected",
            "model_updated",
          ],
        ],
      },
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // True for admin broadcast announcements sent to all active users
    is_broadcast: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // False when created, set to true once the user loads their notifications
    // Used to queue notifications for offline users and deliver on reconnect
    delivered: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: "notifications",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = Notification;
