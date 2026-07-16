export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

export const ROLES = {
  ADMIN: "admin",
  MASTER_ADMIN: "master_admin",
};

// Administrator account statuses
export const USER_STATUS = {
  ACTIVE: "active",
  DEACTIVATED: "deactivated",
  DELETED: "deleted",
};

export const WORD_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const SIGN_TYPE = {
  FSL: "FSL",
  ASL: "ASL",
};

export const CATEGORY = {
  WORD: "word",
  ALPHABET: "alphabet",
};

export const MODEL_STATUS = {
  TRAINED: "trained",
  DEPLOYED: "deployed",
  INACTIVE: "inactive",
};

export const NOTIFICATION_TYPE = {
  GENERAL: "general",
  WORD_APPROVED: "word_approved",
  WORD_REJECTED: "word_rejected",
  MODEL_UPDATED: "model_updated",
};
