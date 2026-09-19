const express = require("express");
const router = express.Router();
const plansCache = new Map();
const PLANS_CACHE_MS = 15000;

const {
  getPlans,
  getFallbackPlans,
  placeOrder,
  getOrderStatus,
  getOrders,
  getWalletBalance,
  getReprocessable,
  reprocessOrder,
  setWebhook,
  isConfigured
} = require("../services/resellerxpress");

router.get("/health", (req, res) => {
  res.json({
    configured: isConfigured(),
    baseUrl: process.env.RESSELLERXPRESS_BASE_URL || "https://resellerxpress.shop/api/v1"
  });
});

router.get("/plans", async (req, res) => {
  const network = String(req.query.network || "mtn").toLowerCase();
  const cached = plansCache.get(network);
  if (cached && Date.now() - cached.updatedAt < PLANS_CACHE_MS) {
    return res.json(cached.data);
  }

  try {
    if (req.app.locals.dbReady === false) {
      return res.json(getFallbackPlans(req.query.network));
    }
    const result = await getPlans(req.query.network, { includeUnavailable: true });
    plansCache.set(network, { data: result, updatedAt: Date.now() });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch ResellerXpress plans"
    });
  }
});

router.post("/place-order", async (req, res) => {
  try {
    const result = await placeOrder(req.body || {});
    return res.status(result.status === "error" ? 400 : 202).json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "ResellerXpress order failed"
    });
  }
});

router.get("/order-status", async (req, res) => {
  try {
    const result = await getOrderStatus(req.query.request_id || req.query.requestId);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to get order status"
    });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const result = await getOrders(req.query);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch orders"
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
      message: error.message || "Failed to fetch wallet balance"
    });
  }
});

router.get("/reprocessable", async (req, res) => {
  try {
    const result = await getReprocessable();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch reprocessable orders"
    });
  }
});

router.post("/reprocess/:id", async (req, res) => {
  try {
    const result = await reprocessOrder(req.params.id);
    return res.status(result.status === "error" ? 400 : 202).json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to reprocess order"
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const result = await setWebhook(req.body.url, req.body.enabled, req.body.events);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to configure webhook"
    });
  }
});

module.exports = router;
