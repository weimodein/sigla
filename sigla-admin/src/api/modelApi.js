import api from "./authApi.js";

export const getAllModels = async () => {
  const response = await api.get("/models");
  return response.data;
};

// Alias used by ReportsAnalytics.jsx
export const getModelVersions = getAllModels;

export const getModelStats = async () => {
  const response = await api.get("/models/stats");
  return response.data;
};

export const getModelById = async (id) => {
  const response = await api.get(`/models/${id}`);
  return response.data;
};

export const getLatestModel = async () => {
  const response = await api.get("/models/latest");
  return response.data;
};

export const trainModel = async (version_number, notes) => {
  const response = await api.post("/models/train", { version_number, notes });
  return response.data;
};

export const getModelStatus = async (id) => {
  const response = await api.get(`/models/${id}/status`);
  return response.data;
};

export const testModel = async (model_id) => {
  const response = await api.post("/models/test", { model_id });
  return response.data;
};

export const deployModel = async (model_id) => {
  const response = await api.post("/models/deploy", { model_id });
  return response.data;
};

export const revertModel = async (model_id) => {
  const response = await api.post("/models/revert", { model_id });
  return response.data;
};

export const deleteModel = async (id) => {
  const response = await api.delete(`/models/${id}`);
  return response.data;
};
