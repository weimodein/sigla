const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getUserStats,
  getUserById,
  approveUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  getAllAdmins,
  createAdmin,
  deleteAdmin,
} = require("../controllers/userController.js");

// All routes require login
router.use(authMiddleware);

// Admin + Super Admin routes
router.get("/", roleMiddleware("admin", "super_admin"), getAllUsers);
router.get("/stats", roleMiddleware("admin", "super_admin"), getUserStats);
router.get("/pending", roleMiddleware("admin", "super_admin"), getPendingUsers);
router.get(
  "/deactivated",
  roleMiddleware("admin", "super_admin"),
  getDeactivatedUsers,
);
router.get("/:id", roleMiddleware("admin", "super_admin"), getUserById);
router.patch(
  "/:id/approve",
  roleMiddleware("admin", "super_admin"),
  approveUser,
);
router.patch(
  "/:id/deactivate",
  roleMiddleware("admin", "super_admin"),
  deactivateUser,
);
router.patch(
  "/:id/reactivate",
  roleMiddleware("admin", "super_admin"),
  reactivateUser,
);
router.put("/:id", roleMiddleware("admin", "super_admin"), updateUser);
router.delete("/:id", roleMiddleware("admin", "super_admin"), deleteUser);

// Super Admin only routes
router.get("/admins/list", roleMiddleware("super_admin"), getAllAdmins);
router.post("/admins", roleMiddleware("super_admin"), createAdmin);
router.delete("/admins/:id", roleMiddleware("super_admin"), deleteAdmin);

module.exports = router;
