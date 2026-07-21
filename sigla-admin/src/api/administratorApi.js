import api from "./authApi.js";

// Administrator account management (administrators table, role_id = 1)

export const getAllAdministrators = async (params) => {
  const response = await api.get("/administrators", { params });
  return response.data;
};

export const getAdministratorStats = async () => {
  const response = await api.get("/administrators/stats");
  return response.data;
};

export const getDeactivatedAdministrators = async () => {
  const response = await api.get("/administrators/deactivated");
  return response.data;
};

export const getDeletedAdministrators = async () => {
  const response = await api.get("/administrators/deleted");
  return response.data;
};

export const getAdministratorById = async (id) => {
  const response = await api.get(`/administrators/${id}`);
  return response.data;
};

export const deactivateAdministrator = async (id, data) => {
  const response = await api.patch(`/administrators/${id}/deactivate`, data);
  return response.data;
};

export const reactivateAdministrator = async (id) => {
  const response = await api.patch(`/administrators/${id}/reactivate`);
  return response.data;
};

export const deleteAdministrator = async (id, data) => {
  const response = await api.delete(`/administrators/${id}`, { data });
  return response.data;
};

export const updateAdministrator = async (id, data) => {
  const response = await api.put(`/administrators/${id}`, data);
  return response.data;
};

export const createAdministrator = async (data) => {
  const response = await api.post("/administrators", data);
  return response.data;
};
