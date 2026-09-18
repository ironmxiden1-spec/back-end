const express = require("express");
const router = express.Router();

const {
  getBundles,
  buyData,
  getPurchaseStatus,
  getWalletBalance,
  isConfigured
} = require("../services/sendcomms");

router.get("/health", (req, res) => {
  res.json({
    configured: isConfigured(),
    baseUrl: process.env.SENDCOMMS_API_BASE_URL || process.env.SENDCOMMS_BASE_URL || "https://api.sendcomms.com/api/v1"
  });
});

router.get("/bundles", async (req, res) => {
  try {
    const result = await getBundles(req.query.network);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch SendComms bundles"
    });
  }
});

router.post("/buy-data", async (req, res) => {
  try {
    const result = await buyData(req.body || {});
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "SendComms purchase failed"
    });
  }
});

router.get("/purchase-status", async (req, res) => {
  try {
    const result = await getPurchaseStatus({
      transactionId: req.query.transaction_id,
      reference: req.query.reference
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to check SendComms purchase status"
    });
  }
});

router.get("/wallet-balance", async (req, res) => {
  try {
    return res.json(await getWalletBalance());
  } catch (error) {
    return res.status(error.response?.status === 404 ? 501 : 502).json({
      status: "unavailable",
      message: error.message || "SendComms wallet balance is unavailable"
    });
  }
});

module.exports = router;
