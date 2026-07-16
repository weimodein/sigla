import api from "./authApi.js";

// Read-only audit trail. Accepts { action, target_type, startDate, endDate,
// search, page, limit } as query params.
export const getActivityLogs = async (params) => {
  const response = await api.get("/activity-logs", { params });
  return response.data;
};
