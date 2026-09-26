import api from "./authApi.js";
import { cachedFetch, cacheKey } from "../utils/apiCache.js";
import { CACHE_KEYS } from "./cacheKeys.js";

// Read-only audit trail. Accepts { action, target_type, startDate, endDate,
// search, page, limit } as query params.
export const getActivityLogs = (params, opts) =>
  cachedFetch(
    cacheKey(CACHE_KEYS.activityLogs, params),
    async () => (await api.get("/activity-logs", { params })).data,
    opts,
  );
