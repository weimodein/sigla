const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(process.env.PG_URI, {
  dialect: "postgres",
  logging: false,
});

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    // Manually add new columns that sync() won't create on existing tables
    await sequelize.query(`
      ALTER TABLE words ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS word_bank_url TEXT;
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS gesture_type VARCHAR(10) DEFAULT 'static';
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS filipino_translation TEXT;
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    console.log("Database connected successfully...");
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
