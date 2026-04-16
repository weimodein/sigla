const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(process.env.PG_URI, {
  dialect: "postgres",
  logging: false,
});

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    console.log("Database connected successfully...");
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
