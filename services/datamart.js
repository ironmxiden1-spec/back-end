const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = () => String(process.env.DATAMART_BASE_URL || "https://api.datamartgh.shop/api/developer").replace(/\/$/, "");
const API_KEY = () => String(process.env.DM_API_KEY || "").trim();
const API_SECRET = () => String(process.env.DM_API_SECRET || "").trim();
const SIGNING_SECRET = () => String(process.env.DM_SIGNING_SECRET || "").trim();

function isConfigured() {
  return Boolean(API_KEY());
}

function getHeaders(extra = {}) {
  return {
    "X-API-Key": API_KEY(),
    "Content-Type": "application/json",
    ...(API_SECRET() ? { "X-API-Secret": API_SECRET() } : {}),
    ...extra
  };
}

function normalizeNetwork(network) {
  const value = String(network || "").trim().toLowerCase();
  if (value.includes("mtn") || value === "yello") return "mtn";
  if (value.includes("telecel") || value.includes("vodafone")) return "telecel";
  if (value.includes("airteltigo") || value.includes("atgo") || value.includes("premium")) return "airteltigo";
  return value;
}

function apiNetwork(network) {
  const normalized = normalizeNetwork(network);
  return { mtn: "YELLO", telecel: "TELECEL", airteltigo: "AT_PREMIUM" }[normalized] || String(network || "").toUpperCase();
}

function unwrap(payload) {
  return payload?.data ?? payload;
}

function normalizePackage(plan, network) {
  const sourceNetwork = plan.network || network;
  const capacity = Number(plan.capacity ?? plan.volumeGb ?? plan.volume ?? plan.data ?? 0);
  const price = Number(plan.price ?? plan.amount ?? 0);
  const normalizedNetwork = normalizeNetwork(sourceNetwork);
  return {
    ...plan,
    id: `datamart:${normalizedNetwork}:${capacity}:${price}`,
    provider: "datamart",
    network: normalizedNetwork,
    name: plan.name || `${capacity}GB ${normalizedNetwork} Bundle`,
    volume: `${capacity}GB`,
    volumeGb: capacity,
    price,
    amount: price,
    total: price,
    fee: 0,
    cost: price,
    available: plan.available !== false && plan.inStock !== false,
    purchasable: plan.available !== false && plan.inStock !== false && capacity > 0 && price > 0,
    feeKnown: true,
    datamartCapacity: String(plan.capacity ?? capacity)
  };
}

async function request(method, path, options = {}) {
  if (!isConfigured()) throw new Error("DataMart API key is not configured");
  try {
    const response = await axios({
      method,
      url: `${BASE_URL()}${path}`,
      ...options,
      headers: getHeaders(options.headers),
      timeout: options.timeout || 12000
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || "DataMart request failed");
  }
}

async function getBundles(network) {
  const payload = await request("get", "/data-packages", {
    params: network ? { network: apiNetwork(network) } : {}
  });
  const data = unwrap(payload);
  const records = Array.isArray(data)
    ? data
    : Object.entries(data || {}).flatMap(([key, items]) => Array.isArray(items) ? items.map((item) => ({ ...item, network: item.network || key })) : []);
  return records.map((plan) => normalizePackage(plan, network)).filter((plan) => plan.volumeGb > 0 && plan.price > 0);
}

async function buyData({ phone, network, volumeGb, capacity, requestId }) {
  const body = {
    phoneNumber: phone,
    network: apiNetwork(network),
    capacity: String(capacity ?? volumeGb),
    gateway: "wallet"
  };
  return request("post", "/purchase", {
    data: body,
    headers: { "X-Idempotency-Key": String(requestId || crypto.randomUUID()) }
  });
}

async function getWalletBalance() {
  return request("get", "/balance");
}

function withdrawalBaseUrl() {
  return BASE_URL().replace(/\/api\/developer$/, "/api/developer/v1/withdrawals");
}

async function withdrawalRequest(method, path, data, idempotencyKey) {
  if (!isConfigured()) throw new Error("DataMart API key is not configured");
  if (!SIGNING_SECRET()) throw new Error("DM_SIGNING_SECRET is not configured");
  const timestamp = String(Date.now());
  const rawBody = data === undefined ? "" : JSON.stringify(data);
  const requestPath = `/api/developer/v1/withdrawals${path}`;
  const signature = crypto.createHmac("sha256", SIGNING_SECRET())
    .update(`${timestamp}.${method.toUpperCase()}.${requestPath}.${rawBody}`)
    .digest("hex");
  try {
    const response = await axios({
      method,
      url: `${withdrawalBaseUrl()}${path}`,
      data,
      headers: getHeaders({
        "X-Idempotency-Key": idempotencyKey,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }),
      timeout: 12000
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.response?.data?.code || error.message || "DataMart withdrawal request failed");
  }
}

async function createWithdrawal(input = {}) {
  const idempotencyKey = String(input.idempotencyKey || crypto.randomUUID());
  const body = {
    amount: Number(input.amount),
    phoneNumber: input.phoneNumber,
    network: String(input.network || "").toUpperCase(),
    ...(input.recipientName ? { recipientName: input.recipientName } : {}),
    ...(input.clientRef ? { clientRef: input.clientRef } : {})
  };
  if (!Number.isFinite(body.amount) || body.amount < 10 || !body.phoneNumber || !body.network) {
    throw new Error("Withdrawal requires amount of at least GHS 10, phoneNumber, and network");
  }
  return withdrawalRequest("post", "", body, idempotencyKey);
}

async function getWithdrawal(reference) {
  if (!reference) throw new Error("Withdrawal reference is required");
  return withdrawalRequest("get", `/${encodeURIComponent(reference)}`, undefined, crypto.randomUUID());
}

async function listWithdrawals(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  return withdrawalRequest("get", params.toString() ? `?${params}` : "", undefined, crypto.randomUUID());
}

async function getWithdrawalLimits() {
  return withdrawalRequest("get", "/meta/limits", undefined, crypto.randomUUID());
}

async function getCheckerProducts() {
  const checkerBase = BASE_URL().replace(/\/api\/developer$/, "/api/checkers");
  const response = await axios.get(`${checkerBase}/products`, { headers: getHeaders(), timeout: 12000 });
  return response.data;
}

async function purchaseChecker({ checkerType, phoneNumber, ref, skipSms = true }) {
  return request("post", "/../checkers/purchase", {
    data: { checkerType, phoneNumber, ref, skipSms },
    headers: { "X-Idempotency-Key": crypto.randomUUID() }
  });
}

module.exports = { isConfigured, getBundles, buyData, getWalletBalance, getCheckerProducts, purchaseChecker, createWithdrawal, getWithdrawal, listWithdrawals, getWithdrawalLimits, normalizeNetwork, apiNetwork, normalizePackage };
