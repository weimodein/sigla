const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role;

    // A super administrator has a superset of admin access, so it satisfies
    // any route that permits "admin".
    const satisfiesAdmin =
      userRole === "super_admin" && allowedRoles.includes("admin");

    if (!userRole || (!allowedRoles.includes(userRole) && !satisfiesAdmin)) {
      return res.status(403).json({
        message: "Access denied. Insufficient permissions.",
      });
    }

    next();
  };
};

module.exports = roleMiddleware;
