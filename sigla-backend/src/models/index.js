const Administrator = require("./Administrator.js");
const EmailVerification = require("./EmailVerification.js");
const Word = require("./Word.js");
const GestureSample = require("./GestureSample.js");
const ModelVersion = require("./ModelVersion.js");
const Category = require("./Category.js");
const ActivityLog = require("./ActivityLog.js");
const UploadJob = require("./UploadJob.js");

// ── Associations ──────────────────────────────────────────────

// EmailVerification belongs to Administrator
EmailVerification.belongsTo(Administrator, { foreignKey: "administrator_id", as: "administrator" });

// Word belongs to Administrator (submitted_by)
Word.belongsTo(Administrator, { foreignKey: "submitted_by", as: "submitter" });
Word.belongsTo(Administrator, { foreignKey: "reviewed_by", as: "reviewer" });
Administrator.hasMany(Word, { foreignKey: "submitted_by", as: "submitted_words" });

// Word belongs to Category. Aliased "category_ref" so it does not collide with
// the flattened `category` name emitted in API responses.
Word.belongsTo(Category, { foreignKey: "category_id", as: "category_ref" });
Category.hasMany(Word, { foreignKey: "category_id", as: "words" });

// GestureSample belongs to Word and Administrator
GestureSample.belongsTo(Word, { foreignKey: "word_id", as: "word" });
GestureSample.belongsTo(Administrator, { foreignKey: "submitted_by", as: "submitter" });
Word.hasMany(GestureSample, { foreignKey: "word_id", as: "samples" });

// ModelVersion belongs to Administrator (trained_by)
ModelVersion.belongsTo(Administrator, { foreignKey: "trained_by", as: "trainer" });

// ActivityLog belongs to Administrator
ActivityLog.belongsTo(Administrator, { foreignKey: "administrator_id", as: "administrator" });
Administrator.hasMany(ActivityLog, { foreignKey: "administrator_id", as: "logs" });

// UploadJob belongs to Word and Administrator (started_by)
UploadJob.belongsTo(Word, { foreignKey: "word_id", as: "word" });
UploadJob.belongsTo(Administrator, { foreignKey: "started_by", as: "starter" });

module.exports = {
  Administrator,
  EmailVerification,
  Word,
  GestureSample,
  ModelVersion,
  Category,
  ActivityLog,
  UploadJob,
};
