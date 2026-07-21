const Administrator = require("./Administrator.js");
const EmailVerification = require("./EmailVerification.js");
const Word = require("./Word.js");
const GestureSample = require("./GestureSample.js");
const ModelVersion = require("./ModelVersion.js");
const Category = require("./Category.js");
const ActivityLog = require("./ActivityLog.js");

// ── Associations ──────────────────────────────────────────────

// EmailVerification belongs to Administrator
EmailVerification.belongsTo(Administrator, { foreignKey: "administrator_id", as: "administrator" });

// Word belongs to Administrator (submitted_by)
Word.belongsTo(Administrator, { foreignKey: "submitted_by", as: "submitter" });
Word.belongsTo(Administrator, { foreignKey: "reviewed_by", as: "reviewer" });
Administrator.hasMany(Word, { foreignKey: "submitted_by", as: "submitted_words" });

// GestureSample belongs to Word and Administrator
GestureSample.belongsTo(Word, { foreignKey: "word_id", as: "word" });
GestureSample.belongsTo(Administrator, { foreignKey: "submitted_by", as: "submitter" });
Word.hasMany(GestureSample, { foreignKey: "word_id", as: "samples" });

// ModelVersion belongs to Administrator (trained_by)
ModelVersion.belongsTo(Administrator, { foreignKey: "trained_by", as: "trainer" });

// ActivityLog belongs to Administrator
ActivityLog.belongsTo(Administrator, { foreignKey: "administrator_id", as: "administrator" });
Administrator.hasMany(ActivityLog, { foreignKey: "administrator_id", as: "logs" });

module.exports = {
  Administrator,
  EmailVerification,
  Word,
  GestureSample,
  ModelVersion,
  Category,
  ActivityLog,
};
