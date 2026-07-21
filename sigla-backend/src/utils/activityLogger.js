const { ActivityLog } = require("../models/index.js");

// Records a significant admin action in the audit trail.
// Deliberately swallows its own errors — an audit-write failure must never
// break the primary action that triggered it.
const logActivity = async ({
  administrator_id = null,
  action,
  target_type = null,
  target_id = null,
  details = "",
  ...rest
}) => {
  try {
    // Guard against the pre-rename `user_id` key. Because this function
    // swallows its errors, an un-renamed caller would otherwise write a NULL
    // actor with no visible failure — surface it loudly instead.
    if ("user_id" in rest) {
      console.error(
        `logActivity: received legacy 'user_id' key for action '${action}' — ` +
          `rename it to 'administrator_id' at the call site.`,
      );
    }

    await ActivityLog.create({
      administrator_id,
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
