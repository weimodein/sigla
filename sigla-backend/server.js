// database configuration
// database configuration
require("dotenv").config();
console.log('🔍 PG_URI after dotenv load:', process.env.PG_URI ? '✅ EXISTS' : '❌ MISSING');
console.log('🔍 All env keys containing DB:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('PG')));

const { connectDB } = require("./src/config/db.js");
const { seedSuperAdmin } = require("./src/seeders/seedSuperAdmin.js");

// module dependencies
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

// route imports
const authRoutes = require("./src/routes/authRoutes.js");
const userRoutes = require("./src/routes/userRoutes.js");
const wordRoutes = require("./src/routes/wordRoutes.js");
const modelRoutes = require("./src/routes/modelRoutes.js");
const notificationRoutes = require("./src/routes/notificationRoutes.js");
const mlRoutes = require("./src/routes/mlRoutes.js"); // ML service routes (internal)
const categoryRoutes = require("./src/routes/categoryRoutes.js");
const activityLogRoutes = require("./src/routes/activityLogRoutes.js");

// application setup
const app = express();

// Trust the first proxy (Render, Railway, Heroku, etc.) so rate-limit and
// logging see the real client IP from X-Forwarded-For instead of the proxy IP.
app.set("trust proxy", 1);

// CORS — restrict to known origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  }),
);

// Rate limiting — auth endpoints only (OTP brute-force / email flood protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// route setup
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/words", wordRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/activity-logs", activityLogRoutes);

// database connection, then seed the super administrator (idempotent)
connectDB().then(() => seedSuperAdmin());

// server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));
