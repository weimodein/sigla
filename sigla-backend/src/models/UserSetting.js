const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const UserSetting = sequelize.define(
  "UserSetting",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    volume: {
      type: DataTypes.INTEGER,
      defaultValue: 80,
      validate: { min: 0, max: 100 },
    },
    voice_type: {
      type: DataTypes.STRING(10),
      defaultValue: "female",
      validate: { isIn: [["male", "female"]] },
    },
    voice_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    text_size: {
      type: DataTypes.STRING(10),
      defaultValue: "medium",
      validate: { isIn: [["small", "medium", "large"]] },
    },
    dark_mode: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // False on first install — set to true after onboarding tutorial is shown
    // Mobile app reads this to decide whether to show the tutorial on launch
    tutorial_shown: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: "user_settings",
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
  },
);

module.exports = UserSetting;
