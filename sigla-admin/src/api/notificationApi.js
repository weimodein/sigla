import api from "./authApi.js";

export const getNotifications = async (params) => {
  const response = await api.get("/notifications", { params });
  return response.data;
};

export const markAsRead = async (id) => {
  const response = await api.patch(`/notifications/${id}/read`);
  return response.data;
};

export const markAllAsRead = async () => {
  const response = await api.patch("/notifications/read-all");
  return response.data;
};

export const deleteNotification = async (id) => {
  const response = await api.delete(`/notifications/${id}`);
  return response.data;
};

export const getUnreadCount = async () => {
  const response = await api.get("/notifications/unread-count");
  return response.data;
};
