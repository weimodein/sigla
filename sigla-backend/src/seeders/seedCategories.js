// One-shot seeder for default categories.
// Usage: node src/seeders/seedCategories.js
require("dotenv").config();
const { connectDB } = require("../config/db.js");
const { Category } = require("../models/index.js");

// Canonical FSL categories — must match the admin (ManageWordBank.jsx) and
// mobile (WordBankActivity.FSL_CATEGORIES) lists so category names align with
// each Word's `category` value and word counts are non-zero.
const DEFAULTS = [
  "introducing oneself",
  "ordering food",
  "buying items",
  "asking for prices",
  "giving numbers",
  "requesting assistance",
  "asking for directions",
  "confirming information",
  "communicating basic needs",
  "alphabets",
  "numbers",
  "additional words",
];

(async () => {
  try {
    await connectDB();

    // Ensure the categories table exists (creates it if missing, leaves it alone otherwise)
    await Category.sync();
    console.log("Categories table ready.");

    let created = 0;
    let skipped = 0;
    for (const name of DEFAULTS) {
      const [, wasCreated] = await Category.findOrCreate({
        where: { name },
        defaults: { name },
      });
      if (wasCreated) created++;
      else skipped++;
    }
    console.log(`Seed complete — created: ${created}, skipped (already existed): ${skipped}`);
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
})();
