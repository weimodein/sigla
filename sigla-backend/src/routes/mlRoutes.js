const express = require("express");
const router = express.Router();
const {
  getApprovedDataset,
  getWordSamplesForVideo,
} = require("../controllers/mlController.js");

// Simple API key middleware
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.ML_API_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

router.get("/dataset", apiKeyAuth, getApprovedDataset);
router.get("/word-samples/:wordId", apiKeyAuth, getWordSamplesForVideo);

module.exports = router;
