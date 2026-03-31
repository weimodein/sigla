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

export const approveSample = (wordId, sampleId) =>
  api.patch(`/words/${wordId}/samples/${sampleId}/approve`).then((r) => r.data);

export const rejectSample = (wordId, sampleId) =>
  api.patch(`/words/${wordId}/samples/${sampleId}/reject`).then((r) => r.data);

export const approveAllSamplesByUser = (wordId, userId) =>
  api
    .patch(`/words/${wordId}/samples/user/${userId}/approve-all`)
    .then((r) => r.data);

export const rejectAllSamplesByUser = (wordId, userId) =>
  api
    .patch(`/words/${wordId}/samples/user/${userId}/reject-all`)
    .then((r) => r.data);

export const approveSubmission = (wordId) =>
  api.patch(`/words/${wordId}/approve-submission`).then((r) => r.data);

export const rejectSubmission = (wordId) =>
  api.patch(`/words/${wordId}/reject-submission`).then((r) => r.data);

export const lockWord = (id) =>
  api.patch(`/words/${id}/lock`).then((r) => r.data);

export const unlockWord = (id) =>
  api.patch(`/words/${id}/unlock`).then((r) => r.data);

export const submitWord = async (data) => {
  const response = await api.post("/words", data);
  return response.data;
};

export const uploadSamples = async (wordId, data) => {
  const response = await api.post(`/words/${wordId}/samples`, data);
  return response.data;
};

export const getUserSampleCount = async (wordId) => {
  const response = await api.get(`/words/${wordId}/user-sample-count`);
  return response.data;
};

export const adminAddWord = async (data) => {
  const response = await api.post("/words/admin-add", data);
  return response.data;
};

export const adminUploadSamples = async (wordId, data) => {
  const response = await api.post(`/words/${wordId}/admin-samples`, data);
  return response.data;
};

export const approveAllSamplesForWord = (wordId) =>
  api.patch(`/words/${wordId}/samples/approve-all`).then((r) => r.data);

export const rejectAllSamplesForWord = (wordId) =>
  api.patch(`/words/${wordId}/samples/reject-all`).then((r) => r.data);

export const setWordThumbnail = (wordId, thumbnail_url) =>
  api.patch(`/words/${wordId}/set-thumbnail`, { thumbnail_url }).then((r) => r.data);

export const setWordVideo = (wordId, data) =>
  api.patch(`/words/${wordId}/set-video`, data).then((r) => r.data);
