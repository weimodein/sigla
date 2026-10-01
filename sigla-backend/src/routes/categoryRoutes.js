const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const requireSetupComplete = require("../middleware/requireSetupComplete.js");
const {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController.js");

// Public — anyone, including guests and the mobile app, can read the list.
router.get("/", getAllCategories);

// Everything below requires a logged-in admin who has finished setup.
router.use(authMiddleware);
router.use(requireSetupComplete);
router.post("/", roleMiddleware("admin"), createCategory);
router.put("/:id", roleMiddleware("admin"), updateCategory);
router.delete("/:id", roleMiddleware("admin"), deleteCategory);

module.exports = router;
