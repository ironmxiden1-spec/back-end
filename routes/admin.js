const express = require("express");
const crypto = require("crypto");
const User = require("../models/user");
const Transaction = require("../models/Transaction");
const AdminSetting = require("../models/AdminSetting");
const reseller = require("../services/resellerxpress");
const remadata = require("../services/remadata");
const sendcomms = require("../services/sendcomms");
const { readData } = require("../utils/fileDb");

const router = express.Router();

function requireAdminToken(req, res, next) {
  const configuredToken = process.env.ADMIN_API_TOKEN;
  const suppliedToken = req.get("X-Admin-Token");

  if (!configuredToken) {
    return res.status(503).json({ msg: "Admin API token is not configured" });
  }

  if (!suppliedToken || suppliedToken.length !== configuredToken.length || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(configuredToken))) {
    return res.status(401).json({ msg: "Admin authentication required" });
  }

  next();
}

function startOfDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

router.use(requireAdminToken);

router.get("/overview", async (req, res) => {
  const fallbackUsers = readData("users.json") || [];
  const fallbackTransactions = readData("transactions.json") || [];
  const today = startOfDay();

  try {
    const [totalUsers, todayTransactions, successfulOrders, pendingOrders, failedOrders] = await Promise.all([
      User.countDocuments(),
      Transaction.find({ date: { $gte: today } }).lean(),
      Transaction.countDocuments({ type: "purchase", status: { $in: ["completed", "success", "successful", "delivered"] } }),
      Transaction.countDocuments({ type: "purchase", status: "pending" }),
      Transaction.countDocuments({ type: "purchase", status: "failed" })
    ]);

    if (Number(totalUsers || 0) <= 0 && fallbackUsers.length > 0) {
      const todayPurchases = fallbackTransactions.filter((tx) => tx.type === "purchase" && new Date(tx.date || Date.now()) >= today);
      const todaySales = todayPurchases.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const todayProfit = todayPurchases.reduce((sum, tx) => sum + Number(tx.actualProfit ?? tx.expectedProfit ?? 0), 0);
      const todayRefunds = fallbackTransactions.filter((tx) => tx.status === "refunded").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      return res.json({
        totalUsers: fallbackUsers.length,
        todaySales: Number(todaySales.toFixed(2)),
        todayProfit: Number(todayProfit.toFixed(2)),
        todayOrders: todayPurchases.length,
        successfulOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && ["completed", "success", "successful", "delivered"].includes(tx.status)).length,
        pendingOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "pending").length,
        failedOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "failed").length,
        todayRefunds
      });
    }

    if (Array.isArray(todayTransactions) && todayTransactions.length === 0 && fallbackTransactions.length > 0) {
      const todayPurchases = fallbackTransactions.filter((tx) => tx.type === "purchase" && new Date(tx.date || Date.now()) >= today);
      const todaySales = todayPurchases.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const todayProfit = todayPurchases.reduce((sum, tx) => sum + Number(tx.actualProfit ?? tx.expectedProfit ?? 0), 0);
      const todayRefunds = fallbackTransactions.filter((tx) => tx.status === "refunded").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      return res.json({
        totalUsers,
        todaySales: Number(todaySales.toFixed(2)),
        todayProfit: Number(todayProfit.toFixed(2)),
        todayOrders: todayPurchases.length,
        successfulOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && ["completed", "success", "successful", "delivered"].includes(tx.status)).length,
        pendingOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "pending").length,
        failedOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "failed").length,
        todayRefunds
      });
    }

    const todayPurchases = todayTransactions.filter((tx) => tx.type === "purchase");
    const todaySales = todayPurchases.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const todayProfit = todayPurchases.reduce((sum, tx) => sum + Number(tx.actualProfit ?? tx.expectedProfit ?? 0), 0);
    const todayRefunds = todayTransactions.filter((tx) => tx.status === "refunded").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return res.json({ totalUsers, todaySales: Number(todaySales.toFixed(2)), todayProfit: Number(todayProfit.toFixed(2)), todayOrders: todayPurchases.length, successfulOrders, pendingOrders, failedOrders, todayRefunds });
  } catch (error) {
    const todayPurchases = fallbackTransactions.filter((tx) => tx.type === "purchase" && new Date(tx.date || Date.now()) >= today);
    const todaySales = todayPurchases.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const todayProfit = todayPurchases.reduce((sum, tx) => sum + Number(tx.actualProfit ?? tx.expectedProfit ?? 0), 0);
    const todayRefunds = fallbackTransactions.filter((tx) => tx.status === "refunded").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return res.json({
      totalUsers: fallbackUsers.length,
      todaySales: Number(todaySales.toFixed(2)),
      todayProfit: Number(todayProfit.toFixed(2)),
      todayOrders: todayPurchases.length,
      successfulOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && ["completed", "success", "successful", "delivered"].includes(tx.status)).length,
      pendingOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "pending").length,
      failedOrders: fallbackTransactions.filter((tx) => tx.type === "purchase" && tx.status === "failed").length,
      todayRefunds
    });
  }
});

router.get("/orders", async (req, res) => {
  const fallbackTransactions = readData("transactions.json") || [];
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const data = await Transaction.find(filter).sort({ date: -1 }).limit(limit).lean();
    if (!Array.isArray(data) || data.length === 0) return res.json({ data: fallbackTransactions.slice(0, limit) });
    return res.json({ data });
  } catch (error) {
    return res.json({ data: fallbackTransactions.slice(0, limit) });
  }
});

router.get("/payments", async (req, res) => {
  const fallbackTransactions = readData("transactions.json") || [];
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  try {
    const data = await Transaction.find({ paymentMethod: { $exists: true, $ne: null } }).sort({ date: -1 }).limit(limit).lean();
    if (!Array.isArray(data) || data.length === 0) return res.json({ data: fallbackTransactions.slice(0, limit) });
    return res.json({ data });
  } catch (error) {
    return res.json({ data: fallbackTransactions.slice(0, limit) });
  }
});

router.get("/customers", async (req, res) => {
  const fallbackUsers = readData("users.json") || [];
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  try {
    const data = await User.find({}, { password: 0, resetPasswordTokenHash: 0, resetPasswordExpires: 0 }).sort({ createdAt: -1 }).limit(limit).lean();
    if (!Array.isArray(data) || data.length === 0) return res.json({ data: fallbackUsers.slice(0, limit) });
    return res.json({ data });
  } catch (error) {
    return res.json({ data: fallbackUsers.slice(0, limit) });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const records = await AdminSetting.find().lean();
    const settings = Object.fromEntries(records.map((record) => [record.key, record.value]));
    return res.json({ settings: { targetProfit: 1, minimumProfit: 0.5, maxOneGb: 5, neverBelowCost: true, autoProvider: true, ...settings } });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to load admin settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const allowed = ["targetProfit", "minimumProfit", "maxOneGb", "neverBelowCost", "autoProvider"];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) {
        const value = ["neverBelowCost", "autoProvider"].includes(key) ? Boolean(req.body[key]) : Number(req.body[key]);
        if (!["neverBelowCost", "autoProvider"].includes(key) && (!Number.isFinite(value) || value < 0)) return res.status(400).json({ msg: `Invalid setting: ${key}` });
        await AdminSetting.findOneAndUpdate({ key }, { key, value, updatedAt: new Date() }, { upsert: true, new: true });
        if (key === "targetProfit" || key === "minimumProfit" || key === "maxOneGb") reseller.configurePricingRules({ [key]: value });
        updates[key] = value;
      }
    }
    return res.json({ settings: updates });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to save admin settings" });
  }
});

router.post("/bulk/validate", async (req, res) => {
  try {
    const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
    const normalized = numbers.map((value) => String(value || "").trim()).filter(Boolean);
    const seen = new Set();
    const valid = [];
    const duplicates = [];
    const invalid = [];
    normalized.forEach((phone) => {
      const compact = phone.replace(/[\s-]/g, "");
      const canonical = compact.startsWith("+233") ? `0${compact.slice(4)}` : compact.startsWith("233") ? `0${compact.slice(3)}` : compact;
      if (seen.has(canonical)) return duplicates.push(phone);
      seen.add(canonical);
      if (!/^0\d{9}$/.test(canonical)) return invalid.push(phone);
      valid.push(canonical);
    });
    return res.json({ valid, duplicates, invalid, counts: { valid: valid.length, duplicates: duplicates.length, invalid: invalid.length } });
  } catch (error) {
    return res.status(400).json({ msg: "Unable to validate bulk numbers" });
  }
});

router.get("/providers", async (req, res) => {
  const providers = [
    { id: "resellerxpress", name: "Reseller", configured: reseller.isConfigured(), balance: null },
    { id: "remadata", name: "RemaData", configured: remadata.isConfigured(), balance: null },
    { id: "sendcomms", name: "SendComms", configured: sendcomms.isConfigured(), balance: null, balanceUnavailable: true }
  ];
  if (providers[0].configured) {
    try { const result = await reseller.getWalletBalance(); providers[0].balance = Number(result.balance ?? result.data?.balance); } catch (error) { providers[0].error = error.message; }
  }
  if (providers[1].configured) {
    try { const result = await remadata.getWalletBalance(); providers[1].balance = Number(result.balance ?? result.data?.balance?.balance ?? result.data?.balance); } catch (error) { providers[1].error = error.message; }
  }
  return res.json({ providers });
});

router.get("/comparison", async (req, res) => {
  try {
    return res.json({ data: await reseller.getPlans(req.query.network), updatedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to load provider comparison" });
  }
});

module.exports = router;
