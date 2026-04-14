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
      ALTER TABLE words ADD COLUMN IF NOT EXISTS sample_limit INTEGER DEFAULT NULL;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS word_bank_url TEXT;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS motion_tflite_url TEXT;
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS gesture_type VARCHAR(10) DEFAULT 'static';
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS filipino_translation TEXT;
      ALTER TABLE word_bank ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS motion_h5_url TEXT;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS motion_accuracy FLOAT;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS motion_classes INTEGER;
      ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS motion_trained BOOLEAN DEFAULT FALSE;
    `);

    console.log("Database connected successfully...");
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
