const User = require("./User.js");
const EmailVerification = require("./EmailVerification.js");
const Word = require("./Word.js");
const GestureSample = require("./GestureSample.js");
const ModelVersion = require("./ModelVersion.js");
const Notification = require("./Notification.js");
const Report = require("./Report.js");
const UserSetting = require("./UserSetting.js");
// const ActivityLog = require("./ActivityLog.js");

// ── Associations ──────────────────────────────────────────────

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
  User,
  EmailVerification,
  Word,
  GestureSample,
  ModelVersion,
  Notification,
  Report,
  UserSetting,
  // ActivityLog,
};
