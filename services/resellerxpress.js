const axios = require("axios");
const AdminSetting = require("../models/AdminSetting");
const { getBundles: getRemaDataBundles, buyData: buyRemaData, isConfigured: isRemaDataConfigured } = require("./remadata");
const { getBundles: getSendCommsBundles, buyData: buySendComms, isConfigured: isSendCommsConfigured, getConfiguredSmsFee, getSmsPricing } = require("./sendcomms");

const DEFAULT_PROVIDER_FEE = Number(process.env.DEFAULT_PROVIDER_FEE || 0.5);
let targetProfit = Number(process.env.TARGET_PROFIT || 1);
let minimumProfit = Number(process.env.MINIMUM_PROFIT || 0.5);
let maximumOneGbPrice = Number(process.env.MAXIMUM_1GB_PRICE || 6);

function getBaseUrl() {
  return process.env.RESSELLERXPRESS_BASE_URL || "https://resellerxpress.shop/api/v1";
}

function getApiKey() {
  return process.env.RESSELLERXPRESS_API_KEY || "";
}

function configurePricingRules(settings = {}) {
  if (Number.isFinite(Number(settings.targetProfit))) targetProfit = Number(settings.targetProfit);
  if (Number.isFinite(Number(settings.minimumProfit))) minimumProfit = Number(settings.minimumProfit);
  if (Number.isFinite(Number(settings.maxOneGb))) maximumOneGbPrice = Number(settings.maxOneGb);
}

async function loadPricingRules() {
  try {
    const records = await AdminSetting.find({ key: { $in: ["targetProfit", "minimumProfit", "maxOneGb"] } }).lean();
    configurePricingRules(Object.fromEntries(records.map((record) => [record.key, record.value])));
  } catch (error) {
    // Environment defaults remain active when the database is unavailable.
  }
}

function isConfigured() {
  return Boolean(getApiKey());
}

function getHeaders() {
  return {
    "X-API-KEY": getApiKey(),
    "Content-Type": "application/json"
  };
}

function getFallbackPlans(network) {
  const normalized = normalizeNetwork(network) || "mtn";
  const volumeTiers = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50];
  const basePrices = {
    mtn: [4, 7, 10, 15, 20, 30, 42, 54, 78, 125],
    airteltigo: [4, 7, 10, 15, 20, 29, 40, 52, 75, 120],
    telecel: [4, 7, 10, 15, 20, 29, 40, 52, 75, 120]
  };
  const names = { mtn: "MTN", airteltigo: "ATgo", telecel: "Telecel" };
  const samples = Object.fromEntries(Object.entries(basePrices).map(([providerNetwork, prices]) => [
    providerNetwork,
    volumeTiers.map((volumeGb, index) => {
      const price = prices[index];
      const idNetwork = providerNetwork === "airteltigo" ? "atgo" : providerNetwork;
      return {
        id: `fallback-${idNetwork}-${volumeGb}gb`,
        provider: "resellerxpress",
        name: `${volumeGb}GB ${names[providerNetwork]} Bundle`,
        network: providerNetwork,
        volume: `${volumeGb}GB`,
        volumeGb,
        price,
        fee: 0.50,
        total: price + 0.50,
        amount: price,
        available: true,
        feeKnown: true,
        feeSource: "fallback"
        ,purchasable: false
      };
    })
  ]));

  return (samples[normalized] || samples.mtn).map((plan) => {
    const pricing = calculateSellingPrice(plan.total, plan.volumeGb);
    const smsPricing = addSmsPricing({ volumeGb: plan.volumeGb }, plan.total);
    if (!smsPricing) return null;
    return {
      ...plan,
      cost: plan.total,
      smsFee: Number(smsPricing.smsFee || 0),
      sellingPrice: smsPricing.sellingPrice || pricing?.sellingPrice,
      expectedProfit: smsPricing.expectedProfit || pricing?.expectedProfit
    };
  }).filter(Boolean);
}

function calculateSellingPrice(totalCost, volumeGb) {
  const cost = Number(totalCost);
  const isOneGb = Math.abs(Number(volumeGb) - 1) < 0.001;
  if (!Number.isFinite(cost) || cost <= 0) return null;

  const targetPrice = cost + targetProfit;
  if (!isOneGb || targetPrice <= maximumOneGbPrice) {
    return {
      sellingPrice: Number(targetPrice.toFixed(2)),
      expectedProfit: Number(targetProfit.toFixed(2))
    };
  }

  const minimumPrice = cost + minimumProfit;
  if (minimumPrice <= maximumOneGbPrice) {
    return {
      sellingPrice: Number(minimumPrice.toFixed(2)),
      expectedProfit: Number(minimumProfit.toFixed(2))
    };
  }

  return null;
}

function addSmsPricing(pricing, totalCost, smsFee = getConfiguredSmsFee()) {
  const adjusted = calculateSellingPrice(Number(totalCost) + smsFee, pricing.volumeGb);
  return adjusted ? { ...adjusted, smsFee } : null;
}

function normalizeNetwork(network) {
  if (!network) return null;

  const value = String(network).trim().toLowerCase();

  if (value.includes("mtn")) return "mtn";
  if (value.includes("airteltigo") || value.includes("atgo")) return "airteltigo";
  if (value.includes("telecel")) return "telecel";

  return value;
}

function normalizePlanRecord(plan, network, provider) {
  const hasFee = ["fee", "handling_fee", "service_fee", "processing_fee"].some((key) => plan[key] !== undefined && plan[key] !== null);
  const price = Number(plan.price ?? plan.amount ?? plan.total ?? 0);
  const fee = hasFee
    ? Number(plan.fee ?? plan.handling_fee ?? plan.service_fee ?? plan.processing_fee)
    : DEFAULT_PROVIDER_FEE;
  const total = hasFee ? Number(plan.total ?? price + fee) : price + fee;
  const normalizedNetwork = normalizeNetwork(plan.network || network || "mtn");
  const rawVolume = plan.volume_gb ?? plan.volume ?? plan.volume_mb ?? plan.volumeInMB ?? plan.capacity_gb ?? plan.capacity_mb;
  const volumeNumber = Number(String(rawVolume ?? "").replace(/[^0-9.]/g, ""));
  const volumeUnit = String(rawVolume ?? "").toLowerCase();
  const volumeGb = plan.volume_gb !== undefined || plan.capacity_gb !== undefined
    ? volumeNumber
    : volumeUnit.includes("mb") || plan.volume_mb !== undefined || plan.volumeInMB !== undefined || plan.capacity_mb !== undefined
      ? volumeNumber / 1024
      : volumeNumber;
  const stableId = `${provider || "provider"}:${normalizedNetwork}:${volumeGb}`;

  return {
    ...plan,
    id: plan.id ?? plan.plan_id ?? plan.slug ?? stableId,
    name: plan.name ?? plan.plan_name ?? plan.bundle_name ?? `${plan.volume ?? plan.volume_mb ?? "Bundle"}`,
    network: normalizedNetwork,
    volume: rawVolume ?? plan.data_size ?? plan.name ?? "Bundle",
    volumeGb,
    price,
    fee,
    total,
    amount: price,
    available: plan.available !== false && plan.in_stock !== false,
    feeKnown: true,
    feeSource: hasFee ? "provider" : "configured_default",
    provider: provider || plan.provider || "resellerxpress"
  };
}

async function getResellerPlans(network) {
  const normalizedNetwork = normalizeNetwork(network);

  if (!isConfigured()) {
    return [];
  }

  try {
    const response = await axios.get(`${getBaseUrl()}/plans`, {
      params: normalizedNetwork ? { network: normalizedNetwork } : {},
      headers: getHeaders(),
      timeout: 2500
    });

    const rawPlans = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data?.plans)
          ? response.data.plans
          : Array.isArray(response.data?.result)
            ? response.data.result
            : [];

    if (rawPlans.length === 0) {
      return [];
    }

    return rawPlans.map((plan) => normalizePlanRecord(plan, normalizedNetwork || network, "resellerxpress"));
  } catch (error) {
    console.warn("ResellerXpress API failed; provider marked unavailable:", error.message);
    return [];
  }
}

async function getRemaDataPlans(network) {
  const normalizedNetwork = normalizeNetwork(network);

  if (!isRemaDataConfigured()) {
    return [];
  }

  try {
    const response = await getRemaDataBundles(normalizedNetwork || network);

    const rawPlans = Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.plans)
          ? response.plans
          : Array.isArray(response?.result)
            ? response.result
            : [];

    return rawPlans.map((plan) => normalizePlanRecord(plan, normalizedNetwork || network, "remadata"));
  } catch (error) {
    console.warn("RemaData API failed, skipping provider:", error.message);
    return [];
  }
}

async function getSendCommsPlans(network) {
  const normalizedNetwork = normalizeNetwork(network);

  if (!isSendCommsConfigured()) {
    return [];
  }

  try {
    const response = await getSendCommsBundles(normalizedNetwork || network);

    const rawPlans = response?.data?.networks && typeof response.data.networks === "object"
      ? (normalizedNetwork ? response.data.networks[normalizedNetwork] || [] : Object.values(response.data.networks).flat())
      : Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.plans)
          ? response.plans
          : Array.isArray(response?.result)
            ? response.result
            : [];

    return rawPlans.map((plan) => normalizePlanRecord(plan, normalizedNetwork || network, "sendcomms"));
  } catch (error) {
    console.warn("SendComms API failed, skipping provider:", error.message);
    return [];
  }
}

async function getPlans(network) {
  await loadPricingRules();
  const normalizedNetwork = normalizeNetwork(network) || network || "mtn";
  const smsPricing = await getSmsPricing();

  const [resellerPlansResult, remadataPlansResult, sendcommsPlansResult] = await Promise.allSettled([
    getResellerPlans(normalizedNetwork),
    getRemaDataPlans(normalizedNetwork),
    getSendCommsPlans(normalizedNetwork)
  ]);

  const resellerPlans = resellerPlansResult.status === "fulfilled" ? resellerPlansResult.value : [];
  const remadataPlans = remadataPlansResult.status === "fulfilled" ? remadataPlansResult.value : [];
  const sendcommsPlans = sendcommsPlansResult.status === "fulfilled" ? sendcommsPlansResult.value : [];

  const combined = [...resellerPlans, ...remadataPlans, ...sendcommsPlans];

  const uniquePlans = [];
  const seen = new Set();

  combined.forEach((plan) => {
    const uniqueKey = `${plan.provider || "provider"}:${plan.id || plan.name}:${plan.volume || plan.name}:${plan.network || normalizedNetwork}`;

    if (seen.has(uniqueKey)) {
      return;
    }

    seen.add(uniqueKey);
    if (plan.available === false || !plan.feeKnown || !Number.isFinite(Number(plan.total)) || Number(plan.total) <= 0) {
      return;
    }

    const pricing = addSmsPricing({ volumeGb: plan.volumeGb }, Number(plan.total), smsPricing.fee);
    if (!pricing) return;

    uniquePlans.push({
      ...plan,
      total: Number(plan.total || 0),
      price: Number(plan.price || 0),
      fee: Number(plan.fee || 0),
      cost: Number(plan.total),
      smsFee: Number(pricing.smsFee || 0),
      sellingPrice: pricing.sellingPrice,
      expectedProfit: pricing.expectedProfit
    });
  });

  if (uniquePlans.length === 0) {
    return getFallbackPlans(normalizedNetwork).map((plan) => ({
      ...plan,
      cost: Number(plan.total || 0),
      price: Number(plan.price || 0),
      fee: Number(plan.fee || 0),
      sellingPrice: Number(plan.sellingPrice || plan.price || 0),
      expectedProfit: Number(plan.expectedProfit || 0)
    }));
  }

  const cheapestByBundle = new Map();
  uniquePlans.forEach((plan) => {
    const volumeGb = Number(plan.volumeGb);
    if (!Number.isFinite(volumeGb) || volumeGb <= 0) return;
    const key = `${plan.network}:${volumeGb}`;
    const current = cheapestByBundle.get(key);
    if (!current || plan.total < current.total) cheapestByBundle.set(key, { ...plan, volumeGb });
  });

  return [...cheapestByBundle.values()].sort((a, b) => a.total - b.total);
}

async function placeProviderOrder(provider, input = {}) {
  const normalizedProvider = String(provider || "").toLowerCase();
  const volumeGb = Number(input.volumeGb || input.volume || 0);

  if (normalizedProvider === "resellerxpress") {
    return placeOrder(input);
  }

  if (!Number.isFinite(volumeGb) || volumeGb <= 0) {
    throw new Error("A valid bundle volume is required for this provider");
  }

  const providerInput = {
    ref: input.request_id,
    phone: input.phone,
    volumeInMB: volumeGb * 1024,
    networkType: input.network
  };

  if (normalizedProvider === "remadata") return buyRemaData(providerInput);
  if (normalizedProvider === "sendcomms") return buySendComms(providerInput);

  throw new Error(`Unsupported provider: ${provider}`);
}

async function placeOrder(input = {}) {
  const planId = input.plan_id ?? input.planId;
  const phone = input.phone ?? input.phoneNumber;
  const quantity = Number(input.quantity ?? 1);
  const requestId = input.request_id ?? input.requestId ?? `WIMPS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!isConfigured()) {
    throw new Error("ResellerXpress provider is not configured");
  }

  if (!planId) {
    throw new Error("A valid plan_id is required for ResellerXpress orders");
  }

  if (!phone) {
    throw new Error("A recipient phone number is required for ResellerXpress orders");
  }

  const payload = {
    plan_id: Number(planId),
    phone,
    request_id: requestId,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 10) : 1
  };

  try {
    const response = await axios.post(`${getBaseUrl()}/place-order`, payload, {
      headers: getHeaders()
    });

    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || "ResellerXpress order failed");
  }
}

async function getOrderStatus(requestId) {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  if (!requestId) {
    throw new Error("request_id is required");
  }

  const response = await axios.get(`${getBaseUrl()}/order-status`, {
    params: { request_id: requestId },
    headers: getHeaders()
  });

  return response.data;
}

async function getOrders(filters = {}) {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  const response = await axios.get(`${getBaseUrl()}/orders`, {
    params: {
      ...filters,
      network: normalizeNetwork(filters.network)
    },
    headers: getHeaders()
  });

  return response.data;
}

async function getWalletBalance() {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  const response = await axios.get(`${getBaseUrl()}/wallet-balance`, {
    headers: getHeaders()
  });

  return response.data;
}

async function getReprocessable() {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  const response = await axios.get(`${getBaseUrl()}/reprocessable`, {
    headers: getHeaders()
  });

  return response.data;
}

async function reprocessOrder(id) {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  if (!id) {
    throw new Error("Order id is required for reprocessing");
  }

  const response = await axios.post(`${getBaseUrl()}/reprocess/${id}`, {}, {
    headers: getHeaders()
  });

  return response.data;
}

async function setWebhook(url, enabled, events) {
  if (!isConfigured()) {
    throw new Error("ResellerXpress API key is not configured");
  }

  if (!url || enabled === undefined || !Array.isArray(events)) {
    throw new Error("url, enabled, and events are required");
  }

  const response = await axios.post(`${BASE_URL}/webhook`, {
    url,
    enabled,
    events
  }, {
    headers: getHeaders()
  });

  return response.data;
}

module.exports = {
  isConfigured,
  getFallbackPlans,
  getPlans,
  placeOrder,
  placeProviderOrder,
  getOrderStatus,
  getOrders,
  getWalletBalance,
  getReprocessable,
  reprocessOrder,
  setWebhook,
  calculateSellingPrice,
  configurePricingRules,
};
