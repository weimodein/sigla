// Idempotent super-administrator seed.
//
// Runs automatically on server startup (see server.js). Ensures a fresh
// deployment always has a super administrator (role_id = 0) without a
// developer creating one by hand. Mirrors the admin-creation flow in
// administratorController.createAdministrator for field parity.
//
// Credentials come from the environment with safe defaults:
//   SUPER_ADMIN_USERNAME (default "superadmin")
//   SUPER_ADMIN_PASSWORD (default "ChangeMe!123" — change on first login)
//
// The seeded account has must_complete_setup = true, so it must link a
// verified email and change its credentials on first login, like any other
// administrator. Email is linked during that setup, so it starts as null.

const bcrypt = require("bcrypt");
const { Administrator } = require("../models/index.js");
const { validatePassword, validateUsername } = require("../utils/validators.js");

const SUPER_ADMIN_ROLE_ID = 0;

const seedSuperAdmin = async () => {
  try {
    // Never create a second super admin.
    const existing = await Administrator.findOne({
      where: { role_id: SUPER_ADMIN_ROLE_ID },
    });
    if (existing) {
      console.log(
        `Super admin seed: already present (username "${existing.username}") — skipped.`,
      );
      return;
    }

    const configuredUsername = process.env.SUPER_ADMIN_USERNAME || "superadmin";
    const password = process.env.SUPER_ADMIN_PASSWORD || "ChangeMe!123";
    const checkedUsername = validateUsername(configuredUsername);
    const passwordError = validatePassword(password);
    if (checkedUsername.error || passwordError) {
      console.error(
        `Super admin seed: invalid credentials (${checkedUsername.error || passwordError}) — skipped.`,
      );
      return;
    }
    const username = checkedUsername.value;

    // Guard against colliding with an existing non-super account (username is unique).
    const usernameTaken = await Administrator.findOne({ where: { username } });
    if (usernameTaken) {
      console.warn(
        `Super admin seed: username "${username}" is already taken by a non-super account — skipped. ` +
          `Set SUPER_ADMIN_USERNAME to a free username to seed the super admin.`,
      );
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await Administrator.create({
      username,
      email: null, // linked during first-login setup
      password: hashedPassword,
      role_id: SUPER_ADMIN_ROLE_ID,
      status: "active",
      // Force first-login onboarding (link verified email + change credentials).
      must_complete_setup: true,
    });

    console.log(
      `Super admin seed: created super administrator "${username}". ` +
        `Complete first-login setup and change the password immediately.`,
    );
  } catch (err) {
    // Never crash the server on a seed failure — surface it and continue.
    console.error("Super admin seed failed (non-fatal):", err.message);
  }
};

module.exports = { seedSuperAdmin };
