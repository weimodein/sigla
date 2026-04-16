const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(process.env.PG_URI, {
  dialect: "postgres",
  logging: false,
});

const runMigrations = async () => {
  // Add columns that were introduced after initial schema creation.
  // IF NOT EXISTS makes each statement safe to re-run on every restart.
  const migrations = [
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_error TEXT`,
  ];
  for (const sql of migrations) {
    await sequelize.query(sql);
  }
};

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await runMigrations();
    console.log("Database connected successfully...");
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
