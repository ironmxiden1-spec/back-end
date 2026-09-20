const express = require("express");
const { getCheckerProducts, isConfigured } = require("../services/datamart");

const router = express.Router();

router.get("/checkers/products", async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ message: "DataMart is not configured" });
  try {
    return res.json(await getCheckerProducts());
  } catch (error) {
    return res.status(503).json({ message: error.message || "Unable to load checker cards" });
  }
});

module.exports = router;
