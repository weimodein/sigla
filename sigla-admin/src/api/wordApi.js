import api from "./authApi.js";
import axios from "axios";
import { cachedFetch } from "../utils/apiCache.js";
import { CACHE_KEYS, withInvalidation } from "./cacheKeys.js";

export const getAllWords = async (params) => {
  const response = await api.get("/words", { params });
  return response.data;
};

// Cached: four pages call this, and the backend runs 7 aggregate queries per
// call. `force` is available for callers that must read live state.
export const getWordStats = (opts) =>
  cachedFetch(
    CACHE_KEYS.wordStats,
    async () => (await api.get("/words/stats")).data,
    opts,
  );

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

export const updateWord = withInvalidation(async (id, data) => (await api.put(`/words/${id}`, data)).data, "word");

export const deleteWord = withInvalidation(async (id) => (await api.delete(`/words/${id}`)).data, "word");

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

export const approveSubmission = (wordId, data) =>
  api.patch(`/words/${wordId}/approve-submission`, data).then((r) => r.data);

export const rejectSubmission = (wordId, data) =>
  api.patch(`/words/${wordId}/reject-submission`, data).then((r) => r.data);

export const lockWord = (id) =>
  api.patch(`/words/${id}/lock`).then((r) => r.data);

export const unlockWord = (id) =>
  api.patch(`/words/${id}/unlock`).then((r) => r.data);

export const submitWord = async (data) => {
  const response = await api.post("/words", data);
  return response.data;
};

export const getUserSampleCount = async (wordId) => {
  const response = await api.get(`/words/${wordId}/user-sample-count`);
  return response.data;
};

export const adminAddWord = withInvalidation(async (data) => (await api.post("/words/admin-add", data)).data, "word");

export const adminUploadSamples = async (wordId, data) => {
  const response = await api.post(`/words/${wordId}/admin-samples`, data);
  return response.data;
};

export const activateWord = (id) =>
  api.patch(`/words/${id}/activate`).then((r) => r.data);

export const approveAllSamplesForWord = (wordId) =>
  api.patch(`/words/${wordId}/samples/approve-all`).then((r) => r.data);

export const rejectAllSamplesForWord = (wordId) =>
  api.patch(`/words/${wordId}/samples/reject-all`).then((r) => r.data);

export const setWordThumbnail = (wordId, thumbnail_url) =>
  api.patch(`/words/${wordId}/set-thumbnail`, { thumbnail_url }).then((r) => r.data);

export const setWordVideo = (wordId, data) =>
  api.patch(`/words/${wordId}/set-video`, data).then((r) => r.data);

export const getMotionSequences = async (wordId) => {
  const response = await api.get(`/words/${wordId}/motion-sequences`);
  return response.data;
};

export const generateVideoFromSequence = async (wordId, sequenceIds) => {
  const response = await api.post(`/words/${wordId}/generate-video`, {
    sequence_ids: sequenceIds,
  });
  return response.data;
};

// Returns 202 with { job } — the clips are uploaded synchronously, but landmark
// extraction runs in a background job on the server. Poll getUploadJob for
// progress; onProgress only covers the byte transfer.
export const uploadVideos = async (wordId, files, onProgress) => {
  const formData = new FormData();
  for (const file of files) formData.append("videos", file);
  const token = localStorage.getItem("token");
  const { API_URL } = await import("../utils/constants.js");
  const response = await axios.post(`${API_URL}/words/${wordId}/upload-videos`, formData, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: onProgress,
  });
  return response.data;
};

export const getUploadJob = async (jobId) => {
  const response = await api.get(`/words/upload-jobs/${jobId}`);
  return response.data;
};

// The live batch for a word, or { job: null } — lets the page re-adopt a job that
// is still running after a reload or navigating back.
export const getActiveUploadJob = async (wordId) => {
  const response = await api.get(`/words/${wordId}/upload-jobs/active`);
  return response.data;
};
