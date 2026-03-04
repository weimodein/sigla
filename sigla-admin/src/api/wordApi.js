import api from "./authApi.js";

export const getAllWords = async (params) => {
  const response = await api.get("/words", { params });
  return response.data;
};

export const getWordStats = async () => {
  const response = await api.get("/words/stats");
  return response.data;
};

export const getWordById = async (id) => {
  const response = await api.get(`/words/${id}`);
  return response.data;
};

export const approveWord = async (id) => {
  const response = await api.patch(`/words/${id}/approve`);
  return response.data;
};

export const rejectWord = async (id, reason) => {
  const response = await api.patch(`/words/${id}/reject`, { reason });
  return response.data;
};

export const updateWord = async (id, data) => {
  const response = await api.put(`/words/${id}`, data);
  return response.data;
};

export const deleteWord = async (id) => {
  const response = await api.delete(`/words/${id}`);
  return response.data;
};

export const getWordSamples = async (id) => {
  const response = await api.get(`/words/${id}/samples`);
  return response.data;
};
