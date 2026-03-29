const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const Role = sequelize.define(
  "Role",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      validate: {
        isIn: [["admin", "user"]],
      },
    },
  },
  {
    tableName: "roles",
    timestamps: false,
  },
);

module.exports = Role;
