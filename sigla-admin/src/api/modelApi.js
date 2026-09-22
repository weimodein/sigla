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

// One call trains BOTH models for this version: the words model and the
// fingerspelling alphabet. They are separate models because a letter and the day
// sign built from it differ only in motion — M and MONDAY separate at 1.06,
// tighter than any day-to-day pair — so one class list carrying both would
// confuse them; but they are trained together so the two cannot drift apart.
// The response's `model` is the words row, which is what the caller polls.
export const trainModel = withInvalidation(async (version_number, notes) => (await api.post("/models/train", { version_number, notes })).data, "model");

export const getModelStatus = async (id) => {
  const response = await api.get(`/models/${id}/status`);
  return response.data;
};

// No longer called from the UI — the Test button was removed, since a trained
// model goes straight to Deploy. The endpoint still exists and works, so this
// stays for a direct call or a future page rather than being deleted.
export const testModel = withInvalidation(async (model_id) => (await api.post("/models/test", { model_id })).data, "model");

export const deployModel = withInvalidation(async (model_id) => (await api.post("/models/deploy", { model_id })).data, "model");

export const revertModel = withInvalidation(async (model_id) => (await api.post("/models/revert", { model_id })).data, "model");

export const deleteModel = withInvalidation(async (id) => (await api.delete(`/models/${id}`)).data, "model");
