import api from "./authApi.js";
import { cachedFetch } from "../utils/apiCache.js";
import { CACHE_KEYS, withInvalidation } from "./cacheKeys.js";

// Cached, but ManageModel passes { force: true }: it reads status === "training"
// from this list to re-adopt a run already in flight, so a stale copy there
// would leave the training banner missing and the run looking stuck forever.
export const getAllModels = (opts) =>
  cachedFetch(CACHE_KEYS.models, async () => (await api.get("/models")).data, opts);

// Alias used by ReportsAnalytics.jsx
export const getModelVersions = getAllModels;

export const getModelStats = (opts) =>
  cachedFetch(CACHE_KEYS.modelStats, async () => (await api.get("/models/stats")).data, opts);

export const getModelById = async (id) => {
  const response = await api.get(`/models/${id}`);
  return response.data;
};

export const getLatestModel = async () => {
  const response = await api.get("/models/latest");
  return response.data;
};

export const trainModel = withInvalidation(async (version_number, notes) => (await api.post("/models/train", { version_number, notes })).data, "model");

export const getModelStatus = async (id) => {
  const response = await api.get(`/models/${id}/status`);
  return response.data;
};

export const testModel = withInvalidation(async (model_id) => (await api.post("/models/test", { model_id })).data, "model");

export const deployModel = withInvalidation(async (model_id) => (await api.post("/models/deploy", { model_id })).data, "model");

export const revertModel = withInvalidation(async (model_id) => (await api.post("/models/revert", { model_id })).data, "model");

export const deleteModel = withInvalidation(async (id) => (await api.delete(`/models/${id}`)).data, "model");
