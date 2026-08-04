const { Administrator } = require("../models/index.js");

// Blocks protected APIs for accounts that still need first-login onboarding
// (scope §10). Apply AFTER authMiddleware. Onboarding endpoints (email verify,
// complete-setup, getMe, logout, self settings) must NOT use this so setup can
// be completed.
const requireSetupComplete = async (req, res, next) => {
  try {
    const user = await Administrator.findByPk(req.user.id, {
      attributes: ["id", "must_complete_setup"],
    });
    if (user && user.must_complete_setup) {
      return res.status(403).json({
        message: "Complete your account setup first.",
        must_complete_setup: true,
      });
    }
    next();
  } catch (err) {
    console.error("requireSetupComplete error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = requireSetupComplete;
