import api from "./authApi.js";
import { cachedFetch } from "../utils/apiCache.js";
import { CACHE_KEYS, withInvalidation } from "./cacheKeys.js";

// Cached: four pages call this, and the backend issues one Word.count() per
// category (an N+1), so it is the most expensive repeat call in the app.
export const getCategories = (opts) =>
  cachedFetch(CACHE_KEYS.categories, () => api.get("/categories").then(r => r.data), opts);

export const createCategory = withInvalidation(
  (data) => api.post("/categories", data).then(r => r.data), "category");

export const updateCategory = withInvalidation(
  (id, data) => api.put(`/categories/${id}`, data).then(r => r.data), "category");

export const deleteCategory = withInvalidation(
  (id) => api.delete(`/categories/${id}`).then(r => r.data), "category");
