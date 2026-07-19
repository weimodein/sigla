const { ActivityLog } = require("../models/index.js");

// Records a significant admin action in the audit trail.
// Deliberately swallows its own errors — an audit-write failure must never
// break the primary action that triggered it.
const logActivity = async ({
  user_id = null,
  action,
  target_type = null,
  target_id = null,
  details = "",
}) => {
  try {
    await ActivityLog.create({
      user_id,
      action,
      target_type,
      target_id,
      details,
    });
  } catch (err) {
    console.error("Activity log write failed:", err.message);
  }
};

module.exports = { logActivity };
