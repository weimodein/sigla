const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { RevokedAuthToken } = require("../models/index.js");
require("dotenv").config();

const authMiddleware = async (req, res, next) => {
  let decoded;
  let token;

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    token = authHeader.split(" ")[1];
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const revoked = await RevokedAuthToken.findOne({
      where: { token_hash: tokenHash },
      attributes: ["id"],
    });

    if (revoked) {
      return res.status(401).json({ message: "Session has been signed out" });
    }

    req.user = decoded;
    req.authTokenHash = tokenHash;
    return next();
  } catch (err) {
    console.error("Session validation error:", err);
    return res.status(500).json({ message: "Unable to validate session" });
  }
};

module.exports = authMiddleware;
