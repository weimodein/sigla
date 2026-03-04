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

export const getUserById = async (id) => {
  const response = await api.get(`/users/${id}`);
  return response.data;
};

export const approveUser = async (id) => {
  const response = await api.patch(`/users/${id}/approve`);
  return response.data;
};

export const deactivateUser = async (id) => {
  const response = await api.patch(`/users/${id}/deactivate`);
  return response.data;
};

export const reactivateUser = async (id) => {
  const response = await api.patch(`/users/${id}/reactivate`);
  return response.data;
};

export const deleteUser = async (id) => {
  const response = await api.delete(`/users/${id}`);
  return response.data;
};

export const updateUser = async (id, data) => {
  const response = await api.put(`/users/${id}`, data);
  return response.data;
};

export const getAllAdmins = async () => {
  const response = await api.get("/users/admins/list");
  return response.data;
};

export const createAdmin = async (data) => {
  const response = await api.post("/users/admins", data);
  return response.data;
};

export const deleteAdmin = async (id) => {
  const response = await api.delete(`/users/admins/${id}`);
  return response.data;
};
