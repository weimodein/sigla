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
    `);

    console.log("Database connected successfully...");
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
