const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const {
  Administrator,
  Word,
  GestureSample,
} = require("../models/index.js");
const { logActivity } = require("../utils/activityLogger.js");
const {
  sendAccountChangeNotice,
  sendPasswordChangedNotice,
  sendAccountStatusNotice,
  sendTemporaryPasswordNotice,
} = require("../utils/mailer.js");
const {
  validatePassword,
  validateUsername,
  validateEmail,
} = require("../utils/validators.js");

// Regular administrator accounts are role_id = 1 (0 = super administrator).
const ADMIN_ROLE_ID = 1;

// ── GET /api/administrators ────────────────────────────────────────────
const getAllAdministrators = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // "All" excludes soft-deleted admins — deleted accounts have their own tab.
    const where = { role_id: ADMIN_ROLE_ID, status: { [Op.ne]: "deleted" } };
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Administrator.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      administrators: rows,
    });
  } catch (err) {
    console.error("Get all administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/administrators/deactivated ────────────────────────────────
const getDeactivatedAdministrators = async (req, res) => {
  try {
    const administrators = await Administrator.findAll({
      where: { status: "deactivated", role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
      order: [["deactivated_at", "DESC"]],
    });
    return res.status(200).json({ administrators });
  } catch (err) {
    console.error("Get deactivated administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/administrators/deleted ────────────────────────────────────
const getDeletedAdministrators = async (req, res) => {
  try {
    const administrators = await Administrator.findAll({
      where: { status: "deleted", role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
      order: [["updated_at", "DESC"]],
    });
    return res.status(200).json({ administrators });
  } catch (err) {
    console.error("Get deleted administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/administrators/stats ──────────────────────────────────────
const getAdministratorStats = async (req, res) => {
  try {
    const [total, active, deactivated, deleted] = await Promise.all([
      Administrator.count({ where: { role_id: ADMIN_ROLE_ID } }),
      Administrator.count({ where: { role_id: ADMIN_ROLE_ID, status: "active" } }),
      Administrator.count({ where: { role_id: ADMIN_ROLE_ID, status: "deactivated" } }),
      Administrator.count({ where: { role_id: ADMIN_ROLE_ID, status: "deleted" } }),
    ]);

    return res.status(200).json({ total, active, deactivated, deleted });
  } catch (err) {
    console.error("Get administrator stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/administrators/:id ────────────────────────────────────────
const getAdministratorById = async (req, res) => {
  try {
    // A non-numeric :id would reach Postgres as an invalid integer cast and
    // surface as a 500. Treat it as "not found" instead.
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    const administrator = await Administrator.findOne({
      where: { id: req.params.id, role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
    });

    if (!administrator) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    return res.status(200).json({ administrator });
  } catch (err) {
    console.error("Get administrator by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/administrators ───────────────────────────────────────────
// Super administrator creates an administrator account.
// Only a username and password are required — the email is linked later
// by the administrator on first login.
const createAdministrator = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    const checkedUsername = validateUsername(username);
    if (checkedUsername.error) {
      return res.status(400).json({ message: checkedUsername.error });
    }
    const trimmedUsername = checkedUsername.value;

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    // Check for an existing username (email is linked later, so not checked here)
    const existing = await Administrator.findOne({
      where: { username: trimmedUsername },
    });
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await Administrator.create({
      username: trimmedUsername,
      email: null,
      password: hashedPassword,
      role_id: ADMIN_ROLE_ID,
      status: "active",
      // New admins must complete first-login setup (link email + change credentials).
      must_complete_setup: true,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "created_admin",
      target_type: "administrator",
      target_id: user.id,
      details: `Created administrator account: ${user.username}`,
    });

    return res.status(201).json({
      message: "Administrator account created successfully",
      administrator: {
        id: user.id,
        username: user.username,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("Create administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Sends a status-change notice without ever letting a mail failure surface as a
// failed request: the status change is already committed by this point, so the
// caller only reports whether the notice got through.
//
// An account with no linked email has nobody to notify — that is not a failure,
// so `notified` stays true.
const notifyStatusChange = async ({ email, username, status }) => {
  if (!email) return true;
  try {
    await sendAccountStatusNotice({ to: email, adminUsername: username, status });
    return true;
  } catch (err) {
    console.error(
      `Failed to send "${status}" status notice to ${email}:`,
      err.message,
    );
    return false;
  }
};

// ── PATCH /api/administrators/:id/deactivate ──────────────────────────
const deactivateAdministrator = async (req, res) => {
  try {
    const user = await Administrator.findOne({
      where: { id: req.params.id, status: "active", role_id: ADMIN_ROLE_ID },
    });

    if (!user) {
      return res.status(404).json({ message: "Active administrator not found" });
    }

    await user.update({
      status: "deactivated",
      deactivated_at: new Date(),
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "deactivated_admin",
      target_type: "administrator",
      target_id: user.id,
      details: `Deactivated administrator: ${user.username}`,
    });

    const notified = await notifyStatusChange({
      email: user.email,
      username: user.username,
      status: "deactivated",
    });

    return res.status(200).json({
      message: "Administrator deactivated successfully.",
      notified,
    });
  } catch (err) {
    console.error("Deactivate administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/administrators/:id/reactivate ──────────────────────────
const reactivateAdministrator = async (req, res) => {
  try {
    const user = await Administrator.findOne({
      where: { id: req.params.id, status: "deactivated", role_id: ADMIN_ROLE_ID },
    });

    if (!user) {
      return res.status(404).json({ message: "Deactivated administrator not found" });
    }

    await user.update({
      status: "active",
      deactivated_at: null,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "reactivated_admin",
      target_type: "administrator",
      target_id: user.id,
      details: `Reactivated administrator: ${user.username}`,
    });

    const notified = await notifyStatusChange({
      email: user.email,
      username: user.username,
      status: "active",
    });

    return res.status(200).json({
      message: "Administrator reactivated successfully",
      notified,
    });
  } catch (err) {
    console.error("Reactivate administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/administrators/:id ─────────────────────────────────────
// Soft delete — sets status to "deleted" to preserve activity logs.
// Cancels the administrator's pending word submissions and detaches
// their approved gesture samples so the dataset stays intact.
const deleteAdministrator = async (req, res) => {
  try {
    const user = await Administrator.findOne({
      where: {
        id: req.params.id,
        role_id: ADMIN_ROLE_ID,
        status: { [Op.in]: ["deactivated", "active"] },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    // Captured before the cascade below, which detaches this administrator from
    // their submissions — the notice still needs to name the right person.
    const deletedEmail = user.email;
    const deletedUsername = user.username;

    // Cancel all pending word submissions from this administrator
    const pendingWords = await Word.findAll({
      where: { submitted_by: user.id, status: "pending" },
    });

    if (pendingWords.length > 0) {
      await Word.update(
        { status: "rejected" },
        { where: { submitted_by: user.id, status: "pending" } },
      );
    }

    // Remove pending and rejected gesture samples submitted by this administrator.
    // Approved samples are retained (nullify submitted_by) to preserve the dataset.
    await GestureSample.destroy({
      where: {
        submitted_by: user.id,
        status: { [Op.in]: ["pending", "rejected"] },
      },
    });
    await GestureSample.update(
      { submitted_by: null },
      { where: { submitted_by: user.id, status: "approved" } },
    );

    // Soft delete — preserves logs and gesture sample references
    await user.update({ status: "deleted" });

    await logActivity({
      administrator_id: req.user.id,
      action: "deleted_admin",
      target_type: "administrator",
      target_id: user.id,
      details: `Deleted administrator: ${user.username}`,
    });

    const notified = await notifyStatusChange({
      email: deletedEmail,
      username: deletedUsername,
      status: "deleted",
    });

    return res.status(200).json({
      message: "Administrator account permanently deleted.",
      cancelled_submissions: pendingWords.length,
      notified,
    });
  } catch (err) {
    console.error("Delete administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/administrators/:id ────────────────────────────────────────
const updateAdministrator = async (req, res) => {
  try {
    // The super administrator may set an administrator's email directly here so
    // that someone locked out of their inbox can still be recovered. An account
    // editing ITSELF still goes through the verified flow
    // (POST /administrators/email/request-code + /administrators/email/verify),
    // which proves control of the address before linking it.
    const { username, email, password } = req.body;

    // Any admin may edit their OWN account; only a super admin may edit others.
    const isSelf = String(req.params.id) === String(req.user.id);
    const isSuper = req.user.role === "super_admin";
    if (!isSelf && !isSuper) {
      return res.status(403).json({
        message: "Access denied. Only the super administrator can edit other accounts.",
      });
    }

    // A super admin must not be able to choose another account's password:
    // knowing it means being able to sign in as that administrator, which would
    // make every administrator_id in activity_logs unprovable. Restoring access
    // goes through POST /administrators/:id/reset-password, which forces the
    // administrator to replace the temporary password at next login.
    if (!isSelf && password) {
      return res.status(400).json({
        message:
          "You cannot set another administrator's password. Use Reset Password instead.",
      });
    }

    // Email here is the super admin acting on someone else. A self-edit must
    // still prove control of the address via the verified flow.
    if (isSelf && email !== undefined) {
      return res.status(400).json({
        message:
          "Verify your own email address through the email verification flow.",
      });
    }

    // Self-edits may target a super account (role_id 0); super-edits of others
    // target administrator accounts (role_id 1).
    const where = isSelf
      ? { id: req.params.id }
      : { id: req.params.id, role_id: ADMIN_ROLE_ID };
    const user = await Administrator.findOne({ where });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    // Username is optional on edit — the form may send a partial payload, in
    // which case the existing username is kept. Validate only what was supplied.
    let nextUsername = user.username;
    if (username) {
      const checkedUsername = validateUsername(username);
      if (checkedUsername.error) {
        return res.status(400).json({ message: checkedUsername.error });
      }
      nextUsername = checkedUsername.value;

      if (nextUsername !== user.username) {
        const taken = await Administrator.findOne({
          where: { username: nextUsername },
        });
        if (taken) {
          return res.status(409).json({ message: "Username already taken" });
        }
      }
    }

    // Email is optional on edit, and only reachable when a super admin is
    // editing someone else (self-edits were rejected above).
    let nextEmail = user.email;
    if (email !== undefined) {
      // An empty value unlinks the address rather than storing "".
      if (email === null || String(email).trim() === "") {
        nextEmail = null;
      } else {
        const emailError = validateEmail(email);
        if (emailError) {
          return res.status(400).json({ message: emailError });
        }
        nextEmail = String(email).trim();

        if (nextEmail !== user.email) {
          const taken = await Administrator.findOne({
            where: { email: nextEmail },
          });
          if (taken && taken.id !== user.id) {
            return res.status(409).json({ message: "Email already in use" });
          }
        }
      }
    }

    // Password is optional on edit, and only reachable on a self-edit.
    const updates = { username: nextUsername, email: nextEmail };
    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ message: passwordError });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    // Capture the before-values so the log entry and the notification can name
    // what actually moved, rather than just saying "updated".
    const previousUsername = user.username;
    const previousEmail = user.email;

    await user.update(updates);

    const changes = [];
    if (nextUsername !== previousUsername) {
      changes.push({ field: "username", from: previousUsername, to: nextUsername });
    }
    if (nextEmail !== previousEmail) {
      changes.push({ field: "email", from: previousEmail, to: nextEmail });
    }

    const changeSummary = changes
      .map((c) => `${c.field} "${c.from ?? "(not set)"}" → "${c.to ?? "(not set)"}"`)
      .join("; ");

    await logActivity({
      administrator_id: req.user.id,
      action: "updated_admin",
      target_type: "administrator",
      target_id: user.id,
      details: changeSummary
        ? `Updated administrator ${previousUsername}: ${changeSummary}${password ? "; password changed" : ""}`
        : `Updated administrator account: ${user.username}${password ? " (password changed)" : ""}`,
    });

    // Notify the affected administrator — including when they changed their own
    // account, so a password change made through a hijacked session still lands
    // in the real owner's inbox. When the address itself changed, the OLD address
    // is told too: it is the only way the affected person learns about a change
    // they did not make. Never fatal — the change is already saved, so a mail
    // outage must not surface as a failed edit.
    const actor = isSelf ? "self" : "super_admin";
    let notified = true;

    if (changes.length > 0) {
      const emailChanged = nextEmail !== previousEmail;
      const recipients = emailChanged
        ? [previousEmail, nextEmail]
        : [nextEmail];

      const targets = [...new Set(recipients.filter(Boolean))];
      for (const to of targets) {
        try {
          await sendAccountChangeNotice({
            to,
            adminUsername: previousUsername,
            changes,
            actor,
          });
        } catch (err) {
          notified = false;
          console.error(`Failed to send account-change notice to ${to}:`, err.message);
        }
      }
    }

    // A password change is its own notice — it is not a field with a before and
    // after, so it never appears in `changes`. Only reachable on a self-edit.
    if (password && nextEmail) {
      try {
        await sendPasswordChangedNotice({
          to: nextEmail,
          adminUsername: previousUsername,
          actor,
        });
      } catch (err) {
        notified = false;
        console.error(
          `Failed to send password-changed notice to ${nextEmail}:`,
          err.message,
        );
      }
    }

    return res.status(200).json({
      message: "Administrator updated successfully",
      notified,
    });
  } catch (err) {
    console.error("Update administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/administrators/:id/reset-password ────────────────────────
// Super administrator sets a TEMPORARY password for an administrator account
// and hands it over directly (in person, by phone — not by email).
//
// This is the only way a super administrator can change someone else's
// password, and it is deliberately self-expiring: must_complete_setup is set
// back to true, so the administrator is forced through onboarding and must
// choose their own username and password before reaching any module. The super
// administrator's knowledge of the temporary password therefore stops being
// useful the moment it is used, which keeps activity-log attribution honest.
const resetAdministratorPassword = async (req, res) => {
  try {
    // A non-numeric :id would reach Postgres as an invalid integer cast and
    // surface as a 500. Treat it as "not found" instead.
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    const { password } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ message: "A temporary password is required" });
    }

    // Same rule as every other password entry point — a reset must not be a
    // way to introduce a weaker password.
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    // Deleted accounts are not recoverable through this route.
    const user = await Administrator.findOne({
      where: {
        id: req.params.id,
        role_id: ADMIN_ROLE_ID,
        status: { [Op.in]: ["active", "deactivated"] },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    await user.update({
      password: await bcrypt.hash(password, 10),
      // Force onboarding again so the administrator replaces this password
      // (and confirms an email) before they can use the account.
      must_complete_setup: true,
      // A locked-out account must actually be recoverable.
      failed_login_attempts: 0,
      lockout_until: null,
      lockout_count: 0,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "reset_admin_password",
      target_type: "administrator",
      target_id: user.id,
      // Never log the password itself.
      details: `Reset the password for administrator ${user.username}; account setup was reset`,
    });

    // Non-fatal, and never carries the password — see mailer.js.
    let notified = true;
    if (user.email) {
      try {
        await sendTemporaryPasswordNotice({
          to: user.email,
          adminUsername: user.username,
        });
      } catch (err) {
        notified = false;
        console.error(
          `Failed to send password-reset notice to ${user.email}:`,
          err.message,
        );
      }
    }

    return res.status(200).json({
      message:
        "Password reset. Give the temporary password to the administrator directly — they must choose their own credentials at next login.",
      notified,
      username: user.username,
      has_email: Boolean(user.email),
    });
  } catch (err) {
    console.error("Reset administrator password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/administrators/complete-setup ────────────────────────────
// Finishes forced first-login onboarding for the logged-in account:
// requires that an email is already linked (email-first), then sets the new
// password and clears the must_complete_setup flag.
//
// Username is OPTIONAL. must_complete_setup is set in two different situations
// — a brand-new account, and an account whose password the super administrator
// just reset — and only the first is a reason to demand a new username. A
// password reset must force a password change and nothing else.
const completeSetup = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await Administrator.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.must_complete_setup) {
      return res.status(400).json({ message: "Account setup is already complete" });
    }

    // Email-first: an email must have been linked (via the verified email flow).
    // Already satisfied for any account arriving here from a password reset.
    if (!user.email) {
      return res
        .status(400)
        .json({ message: "Link and verify your email address first" });
    }

    if (!password) {
      return res.status(400).json({ message: "A new password is required" });
    }

    // Keep the existing username when none is supplied.
    let trimmedUsername = user.username;
    if (username !== undefined && String(username).trim() !== "") {
      const checkedUsername = validateUsername(username);
      if (checkedUsername.error) {
        return res.status(400).json({ message: checkedUsername.error });
      }
      trimmedUsername = checkedUsername.value;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    if (trimmedUsername !== user.username) {
      const taken = await Administrator.findOne({ where: { username: trimmedUsername } });
      if (taken) {
        return res.status(409).json({ message: "Username already taken" });
      }
    }

    await user.update({
      username: trimmedUsername,
      password: await bcrypt.hash(password, 10),
      must_complete_setup: false,
    });

    await logActivity({
      administrator_id: user.id,
      action: "completed_setup",
      target_type: "administrator",
      target_id: user.id,
      details: "Completed first-login account setup",
    });

    return res.status(200).json({ message: "Account setup complete" });
  } catch (err) {
    console.error("Complete setup error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllAdministrators,
  getDeactivatedAdministrators,
  getDeletedAdministrators,
  getAdministratorStats,
  getAdministratorById,
  createAdministrator,
  deactivateAdministrator,
  reactivateAdministrator,
  deleteAdministrator,
  updateAdministrator,
  resetAdministratorPassword,
  completeSetup,
};
