import api from "./authApi.js";

// Administrator account management (users table, role_id = 1)

export const getAllUsers = async (params) => {
  const response = await api.get("/users", { params });
  return response.data;
};

export const getUserStats = async () => {
  const response = await api.get("/users/stats");
  return response.data;
};

export const getDeactivatedUsers = async () => {
  const response = await api.get("/users/deactivated");
  return response.data;
};

export const getDeletedUsers = async () => {
  const response = await api.get("/users/deleted");
  return response.data;
};

export const getUserById = async (id) => {
  const response = await api.get(`/users/${id}`);
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
