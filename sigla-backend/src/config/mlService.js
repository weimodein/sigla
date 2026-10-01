// Base URL of the FastAPI ML service (training, evaluation, landmark extraction).
module.exports = {
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://localhost:8000",
};
