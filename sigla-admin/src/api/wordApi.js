import api from "./authApi.js";
import axios from "axios";
import { cachedFetch, cacheKey } from "../utils/apiCache.js";
import { CACHE_KEYS, withInvalidation } from "./cacheKeys.js";

export const getAllWords = (params, opts) =>
  cachedFetch(
    cacheKey(CACHE_KEYS.words, params),
    async () => (await api.get("/words", { params })).data,
    opts,
  );

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

export const approveWord = withInvalidation(async (id) => {
  const response = await api.patch(`/words/${id}/approve`);
  return response.data;
}, "word");

export const rejectWord = withInvalidation(async (id, reason) => {
  const response = await api.patch(`/words/${id}/reject`, { reason });
  return response.data;
}, "word");

export const updateWord = withInvalidation(async (id, data) => (await api.put(`/words/${id}`, data)).data, "word");

export const deleteWord = withInvalidation(async (id) => (await api.delete(`/words/${id}`)).data, "word");

// Clear a word's training data without removing the word itself. The server
// requires ?confirm=<label> to match exactly — it will not act on an id alone,
// since the deletion is unrecoverable and the row count is not visible from the
// URL. Callers pass the label they displayed to the user.
export const deleteAllWordSamples = withInvalidation(
  async (id, label) =>
    (await api.delete(`/words/${id}/samples`, { params: { confirm: label } })).data,
  "word",
);

export const getWordSamples = async (id) => {
  const response = await api.get(`/words/${id}/samples`);
  return response.data;
};

export const approveSample = withInvalidation(
  (wordId, sampleId) => api.patch(`/words/${wordId}/samples/${sampleId}/approve`).then((r) => r.data),
  "word",
);

export const rejectSample = withInvalidation(
  (wordId, sampleId) => api.patch(`/words/${wordId}/samples/${sampleId}/reject`).then((r) => r.data),
  "word",
);

export const approveAllSamplesByUser = withInvalidation(
  (wordId, userId) => api.patch(`/words/${wordId}/samples/user/${userId}/approve-all`).then((r) => r.data),
  "word",
);

export const rejectAllSamplesByUser = withInvalidation(
  (wordId, userId) => api.patch(`/words/${wordId}/samples/user/${userId}/reject-all`).then((r) => r.data),
  "word",
);

export const approveSubmission = withInvalidation(
  (wordId, data) => api.patch(`/words/${wordId}/approve-submission`, data).then((r) => r.data),
  "word",
);

export const rejectSubmission = withInvalidation(
  (wordId, data) => api.patch(`/words/${wordId}/reject-submission`, data).then((r) => r.data),
  "word",
);

export const lockWord = withInvalidation(
  (id) => api.patch(`/words/${id}/lock`).then((r) => r.data),
  "word",
);

export const unlockWord = withInvalidation(
  (id) => api.patch(`/words/${id}/unlock`).then((r) => r.data),
  "word",
);

export const submitWord = withInvalidation(async (data) => {
  const response = await api.post("/words", data);
  return response.data;
}, "word");

export const getUserSampleCount = async (wordId) => {
  const response = await api.get(`/words/${wordId}/user-sample-count`);
  return response.data;
};

export const adminAddWord = withInvalidation(async (data) => (await api.post("/words/admin-add", data)).data, "word");

export const adminUploadSamples = withInvalidation(async (wordId, data) => {
  const response = await api.post(`/words/${wordId}/admin-samples`, data);
  return response.data;
}, "word");

export const activateWord = withInvalidation(
  (id) => api.patch(`/words/${id}/activate`).then((r) => r.data),
  "word",
);

export const approveAllSamplesForWord = withInvalidation(
  (wordId) => api.patch(`/words/${wordId}/samples/approve-all`).then((r) => r.data),
  "word",
);

export const rejectAllSamplesForWord = withInvalidation(
  (wordId) => api.patch(`/words/${wordId}/samples/reject-all`).then((r) => r.data),
  "word",
);

export const setWordThumbnail = withInvalidation(
  (wordId, thumbnail_url) => api.patch(`/words/${wordId}/set-thumbnail`, { thumbnail_url }).then((r) => r.data),
  "word",
);

export const setWordVideo = withInvalidation(
  (wordId, data) => api.patch(`/words/${wordId}/set-video`, data).then((r) => r.data),
  "word",
);

export const getMotionSequences = async (wordId) => {
  const response = await api.get(`/words/${wordId}/motion-sequences`);
  return response.data;
};

export const generateVideoFromSequence = withInvalidation(async (wordId, sequenceIds) => {
  const response = await api.post(`/words/${wordId}/generate-video`, {
    sequence_ids: sequenceIds,
  });
  return response.data;
}, "word");

// Returns 202 with { job } — the clips are uploaded synchronously, but landmark
// extraction runs in a background job on the server. Poll getUploadJob for
// progress; onProgress only covers the byte transfer.
export const uploadVideos = async (wordId, files, sessionId, onProgress) => {
  const formData = new FormData();
  for (const file of files) formData.append("videos", file);
  formData.append("session_id", sessionId.trim());
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

// Signer IDs already present in the dataset, with each one's sample count for
// the given word (dataset-wide if wordId is omitted).
//
// session_id is the grouping key for signer-held-out cross-validation, so a
// typo splits one person into two and quietly inflates reported accuracy. The
// upload dialog offers these for selection rather than relying on the operator
// retyping an id correctly every time.
//
// Cached per word: reopening the upload modal for the same word within the TTL
// shows the list instantly instead of re-running the query. The upload poller's
// invalidate("words:") already clears this on completion, since the key shares
// that prefix, so a finished batch's counts are never served stale.
export const getSignerIds = (wordId) =>
  cachedFetch(cacheKey(CACHE_KEYS.signers, { word_id: wordId || "" }), async () => {
    const response = await api.get("/words/signers", {
      params: wordId ? { word_id: wordId } : undefined,
    });
    return response.data;
  });

export const getUploadJob = async (jobId) => {
  const response = await api.get(`/words/upload-jobs/${jobId}`);
  return response.data;
};

// Every extraction batch running right now, across all words and admins.
//
// Replaces asking per visible word: that capped visibility at the current page,
// and the page kept only the first job it found. Two admins uploading to
// different words is allowed by the server, so the second one's batch showed no
// progress at all and looked like a failure worth retrying.
export const getActiveUploadJobs = async () => {
  const response = await api.get("/words/upload-jobs/active");
  return response.data;
};

// The live batch for a word, or { job: null } — lets the page re-adopt a job that
// is still running after a reload or navigating back.
export const getActiveUploadJob = async (wordId) => {
  const response = await api.get(`/words/${wordId}/upload-jobs/active`);
  return response.data;
};
