const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController.js");

// Public — anyone, including guests, can read the category list
router.get("/", getAllCategories);

// Everything below still requires a logged-in admin
router.use(authMiddleware);
router.post("/", roleMiddleware("admin"), createCategory);
router.put("/:id", roleMiddleware("admin"), updateCategory);
router.delete("/:id", roleMiddleware("admin"), deleteCategory);
router.get("/public", getAllCategories);

module.exports = router;
