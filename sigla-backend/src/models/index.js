const Role = require("./Role.js");
const User = require("./User.js");
const EmailVerification = require("./EmailVerification.js");
const Word = require("./Word.js");
const GestureSample = require("./GestureSample.js");
const ModelVersion = require("./ModelVersion.js");
const WordBank = require("./WordBank.js");
const Notification = require("./Notification.js");
const Report = require("./Report.js");
const UserSetting = require("./UserSetting.js");
// const ActivityLog = require("./ActivityLog.js");

// ── Associations ──────────────────────────────────────────────

// User belongs to Role
User.belongsTo(Role, { foreignKey: "role_id", as: "role" });
Role.hasMany(User, { foreignKey: "role_id", as: "users" });

// EmailVerification belongs to User
EmailVerification.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Word belongs to User (submitted_by)
Word.belongsTo(User, { foreignKey: "submitted_by", as: "submitter" });
Word.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" });
User.hasMany(Word, { foreignKey: "submitted_by", as: "submitted_words" });

// GestureSample belongs to Word and User
GestureSample.belongsTo(Word, { foreignKey: "word_id", as: "word" });
GestureSample.belongsTo(User, { foreignKey: "submitted_by", as: "submitter" });
Word.hasMany(GestureSample, { foreignKey: "word_id", as: "samples" });

// ModelVersion belongs to User (trained_by)
ModelVersion.belongsTo(User, { foreignKey: "trained_by", as: "trainer" });

// WordBank belongs to Word
WordBank.belongsTo(Word, { foreignKey: "word_id", as: "word" });
Word.hasOne(WordBank, { foreignKey: "word_id", as: "word_bank_entry" });

// Notification belongs to User
Notification.belongsTo(User, { foreignKey: "user_id", as: "user" });
User.hasMany(Notification, { foreignKey: "user_id", as: "notifications" });

// Report belongs to User
Report.belongsTo(User, { foreignKey: "submitted_by", as: "submitter" });
Report.belongsTo(User, { foreignKey: "resolved_by", as: "resolver" });

// UserSetting belongs to User
UserSetting.belongsTo(User, { foreignKey: "user_id", as: "user" });
User.hasOne(UserSetting, { foreignKey: "user_id", as: "settings" });

// ActivityLog belongs to User
// ActivityLog.belongsTo(User, { foreignKey: "user_id", as: "user" });
// User.hasMany(ActivityLog, { foreignKey: "user_id", as: "logs" });

module.exports = {
  Role,
  User,
  EmailVerification,
  Word,
  GestureSample,
  ModelVersion,
  WordBank,
  Notification,
  Report,
  UserSetting,
  // ActivityLog,
};
