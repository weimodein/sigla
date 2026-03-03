// database configuration
require("dotenv").config();
const { connectDB } = require("./src/config/db.js");

// module dependencies
const express = require("express");
const cors = require("cors");

// routes
const authRoutes = require("./src/routes/authRoutes.js");
const userRoutes = require("./src/routes/userRoutes.js");
// const wordRoutes = require("./src/routes/wordRoutes.js");
// const modelRoutes = require("./src/routes/modelRoutes.js");

// application setup
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
// app.use("/api/words", wordRoutes);
// app.use("/api/models", modelRoutes);

// database connection
connectDB();

// server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));
