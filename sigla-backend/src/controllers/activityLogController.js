const { Op } = require("sequelize");
const { ActivityLog, Administrator } = require("../models/index.js");
const { maskEmailAddresses } = require("../utils/maskEmailAddresses.js");

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

    // Date range filter on created_at, inclusive of the whole first and last day.
    //
    // Both bounds must be built in the SAME time frame. `new Date("2026-07-29")`
    // is parsed as UTC midnight by spec, while setHours() below works in local
    // time — so the start landed 8 hours later than the end's frame at UTC+8 and
    // every log from 00:00 to 07:59 local on the first selected day was silently
    // excluded. Constructing from explicit parts gives local midnight, matching
    // the local end-of-day, so a single-day filter now covers the whole day.
    const localStartOfDay = (value) => {
      const [y, m, d] = String(value).split("-").map(Number);
      if (!y || !m || !d) return new Date(value); // unexpected format: leave as-is
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };

    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at[Op.gte] = localStartOfDay(startDate);
      if (endDate) {
        const end = localStartOfDay(endDate);
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

    const maskedRows = rows.map((row) => {
      const log = row.toJSON();
      return { ...log, details: maskEmailAddresses(log.details) };
    });

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      logs: maskedRows,
    });
  } catch (err) {
    console.error("Get activity logs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getActivityLogs };
