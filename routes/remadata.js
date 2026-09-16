const express = require("express");
const router = express.Router();

const {
  getBundles,
  getCostPrice,
  buyData,
  getWalletBalance,
  isConfigured
} = require("../services/remadata");

router.get("/health", (req, res) => {
  res.json({
    configured: isConfigured(),
    baseUrl: process.env.REMADATA_BASE_URL || "https://remadata.com/api"
  });
});

router.get("/bundles", async (req, res) => {
  try {
    const result = await getBundles(req.query.network);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch RemaData bundles"
    });
  }
});

router.post("/get-cost-price", async (req, res) => {
  try {
    const { networkType, volumeInMB } = req.body || {};

    if (!networkType || volumeInMB === undefined || volumeInMB === null || volumeInMB === "") {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: volumeInMB, networkType"
      });
    }

    const apiPrice = await getCostPrice(networkType, volumeInMB);

    return res.json({
      status: "success",
      volume: `${volumeInMB}MB`,
      network: networkType,
      api_price: String(apiPrice),
      currency: "GHS"
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch RemaData cost price"
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
      message: error.message || "RemaData purchase failed"
    });
  }
});

router.get("/wallet-balance", async (req, res) => {
  try {
    const result = await getWalletBalance();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch RemaData wallet balance"
    });
  }
});

module.exports = router;
