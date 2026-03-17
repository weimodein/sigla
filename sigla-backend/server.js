// database configuration
require("dotenv").config();
const { connectDB } = require("./src/config/db.js");

// module dependencies
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const {
  runAutoReactivationJob,
} = require("./src/controllers/userController.js");

// route imports
const authRoutes = require("./src/routes/authRoutes.js");
const userRoutes = require("./src/routes/userRoutes.js");
const wordRoutes = require("./src/routes/wordRoutes.js");
const modelRoutes = require("./src/routes/modelRoutes.js");
const notificationRoutes = require("./src/routes/notificationRoutes.js");

// application setup
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// route setup
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/words", wordRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/notifications", notificationRoutes);

// database connection
connectDB();

// auto reactivation job — runs every day at midnight
cron.schedule("0 0 * * *", () => {
  console.log("Running auto reactivation job...");
  runAutoReactivationJob();
});

// server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));
