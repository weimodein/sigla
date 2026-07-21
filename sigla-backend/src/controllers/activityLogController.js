const { Op } = require("sequelize");
const { ActivityLog, Administrator } = require("../models/index.js");

// ── GET /api/activity-logs ────────────────────────────────────
// Read-only, system-wide audit trail. Supports filtering by action,
// target_type (affected item), date range, and a free-text search on details.
const getActivityLogs = async (req, res) => {
  try {
    const {
      action,
      target_type,
      startDate,
      endDate,
      search,
      mine,
      page = 1,
      limit = 20,
    } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    // When mine=true, scope to the logged-in account's own actions
    // (used by the dashboard's "recent activity" feed).
    if (mine === "true") where.administrator_id = req.user.id;
    if (action) where.action = action;
    if (target_type) where.target_type = target_type;
    if (search) where.details = { [Op.iLike]: `%${search}%` };

    // Date range filter on created_at (inclusive of the whole end day)
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = end;
      }
    }

    const { count, rows } = await ActivityLog.findAndCountAll({
      where,
      include: [
        {
          model: Administrator,
          as: "administrator",
          attributes: ["id", "username"],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      logs: rows,
    });
  } catch (err) {
    console.error("Get activity logs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getActivityLogs };
