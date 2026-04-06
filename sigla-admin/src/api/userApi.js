import api from "./authApi.js";

export const getAllUsers = async (params) => {
  const response = await api.get("/users", { params });
  return response.data;
};

export const getUserStats = async () => {
  const response = await api.get("/users/stats");
  return response.data;
};

export const getPendingUsers = async () => {
  const response = await api.get("/users/pending");
  return response.data;
};

export const getDeactivatedUsers = async () => {
  const response = await api.get("/users/deactivated");
  return response.data;
};

export const getWarnedUsers = async () => {
  const response = await api.get("/users/warned");
  return response.data;
};

export const getUserById = async (id) => {
  const response = await api.get(`/users/${id}`);
  return response.data;
};

export const approveUser = async (id) => {
  const response = await api.patch(`/users/${id}/approve`);
  return response.data;
};

export const warnUser = async (id, data) => {
  const response = await api.patch(`/users/${id}/warn`, data);
  return response.data;
};

export const deactivateUser = async (id, data) => {
  const response = await api.patch(`/users/${id}/deactivate`, data);
  return response.data;
};

export const reactivateUser = async (id) => {
  const response = await api.patch(`/users/${id}/reactivate`);
  return response.data;
};

export const deleteUser = async (id, data) => {
  const response = await api.delete(`/users/${id}`, { data });
  return response.data;
};

export const updateUser = async (id, data) => {
  const response = await api.put(`/users/${id}`, data);
  return response.data;
};

export const createUser = async (data) => {
  const response = await api.post("/users", data);
  return response.data;
};

export const getUserRegistrations = async (period = "month") => {
  const response = await api.get("/users/registrations", { params: { period } });
  return response.data;
};

export const getRecentActivity = async (limit = 10) => {
  const response = await api.get("/users/activity", { params: { limit } });
  return response.data;
};
