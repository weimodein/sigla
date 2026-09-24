const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

// Stores only a one-way hash of a signed JWT. A successful logout inserts the
// token here, and authMiddleware rejects it until its natural expiry. Keeping
// the raw bearer token out of the database means this table cannot be used to
// impersonate an administrator if it is exposed.
const RevokedAuthToken = sequelize.define(
  "RevokedAuthToken",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    token_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    administrator_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: "revoked_auth_tokens",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

module.exports = RevokedAuthToken;
