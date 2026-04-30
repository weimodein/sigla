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

router.use(authMiddleware);

router.get("/", roleMiddleware("admin"), getAllCategories);
router.post("/", roleMiddleware("admin"), createCategory);
router.put("/:id", roleMiddleware("admin"), updateCategory);
router.delete("/:id", roleMiddleware("admin"), deleteCategory);

module.exports = router;
