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
      tzOffset,
      page: rawPage = 1,
      limit: rawLimit = 20,
    } = req.query;

    // Bounded so a request cannot demand an unlimited page size (?limit=1000000
    // would otherwise dump the whole table in one response), and so a bad value
    // (missing, non-numeric, negative) falls back to a sane default instead of
    // producing NaN offsets/totals downstream.
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    // When mine=true, scope to the logged-in account's own actions
    // (used by the dashboard's "recent activity" feed).
    if (mine === "true") where.administrator_id = req.user.id;
    if (action) where.action = action;
    if (target_type) where.target_type = target_type;
    if (search) where.details = { [Op.iLike]: `%${search}%` };

    // Date range filter on created_at, inclusive of the whole first and last day
    // IN THE VIEWER'S TIMEZONE, not the server's.
    //
    // tzOffset is JS's getTimezoneOffset() from the browser: minutes to ADD to
    // local time to reach UTC (e.g. -480 at UTC+8). "Midnight in the viewer's
    // timezone" is therefore UTC midnight for that date, shifted by -tzOffset
    // minutes. Without it (an older client, or a direct API call) this falls
    // back to the server's own local time, which is what this used to do
    // unconditionally — correct only when the server and every viewer share a
    // timezone. A deployed server typically runs in UTC while admins view from
    // UTC+8, and building boundaries from the server's clock shifted a
    // single-day filter by up to 8 hours, silently dropping early-morning rows.
    const offsetMinutes = Number.parseInt(tzOffset, 10) || 0;
    const startOfDayForViewer = (value) => {
      const [y, m, d] = String(value).split("-").map(Number);
      if (!y || !m || !d) return new Date(value); // unexpected format: leave as-is
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) + offsetMinutes * 60000);
    };

    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at[Op.gte] = startOfDayForViewer(startDate);
      if (endDate) {
        const end = startOfDayForViewer(endDate);
        end.setUTCHours(end.getUTCHours() + 24, 0, 0, -1); // end of that same local day
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
      limit,
      offset,
    });

    const maskedRows = rows.map((row) => {
      const log = row.toJSON();
      return { ...log, details: maskEmailAddresses(log.details) };
    });

    return res.status(200).json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      logs: maskedRows,
    });
  } catch (err) {
    console.error("Get activity logs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getActivityLogs };
