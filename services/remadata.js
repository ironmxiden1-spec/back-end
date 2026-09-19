const axios = require("axios");

function getBaseUrl() {
  return process.env.REMADATA_BASE_URL || "https://remadata.com/api";
}

function getApiKey() {
  return process.env.REMADATA_API_KEY || "";
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

function normalizeNetwork(network) {
  if (!network) return null;

  const value = String(network).trim().toLowerCase();

  if (value.includes("mtn")) return "mtn";
  if (value.includes("telecel")) return "telecel";
  if (value.includes("airteltigo") || value.includes("atgo")) return "airteltigo";

  return value;
}

function normalizeVolume(volume) {
  if (volume === undefined || volume === null || volume === "") {
    return null;
  }

  if (typeof volume === "number") {
    return volume;
  }

  const text = String(volume).trim().toLowerCase();

  if (!text) {
    return null;
  }

  if (text.endsWith("mb")) {
    return Number(text.replace(/[^\d.]/g, ""));
  }

  if (text.endsWith("gb")) {
    return Number(text.replace(/[^\d.]/g, "")) * 1024;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  return null;
}

function normalizeBundleSize(payload = {}) {
  const directVolume = normalizeVolume(payload.volumeInMB || payload.volume || payload.capacity || payload.bundle_size || payload.bundle);

  if (directVolume !== null) {
    return directVolume;
  }

  if (payload.bundle && typeof payload.bundle === "string") {
    const match = payload.bundle.match(/(\d+(?:\.\d+)?)\s*(gb|mb)/i);

    if (match) {
      return normalizeVolume(match[0]);
    }
  }

  return null;
}

function normalizePurchaseInput(body = {}) {
  const networkType = normalizeNetwork(
    body.networkType || body.network || body.network_name || body.providerNetwork
  );

  const phone = body.phone || body.phoneNumber || body.recipientPhone || body.msisdn;
  const volumeInMB = normalizeBundleSize(body);
  const ref = body.ref || body.reference || `WIMPS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const bundleLabel =
    body.bundle_size ||
    body.bundle ||
    body.capacity ||
    (volumeInMB ? `${(volumeInMB / 1024).toFixed(volumeInMB % 1024 === 0 ? 0 : 2)}GB` : "");

  return {
    networkType,
    phone,
    volumeInMB,
    ref,
    bundleLabel
  };
}

async function getBundles(network) {
  if (!isConfigured()) {
    throw new Error("RemaData API key is not configured");
  }

  const url = `${getBaseUrl()}/bundles`;
  const params = network ? { network } : {};

  const response = await axios.get(url, {
    params,
    headers: getHeaders(),
    timeout: 2500
  });

  return response.data;
}

async function getCostPrice(networkType, volumeInMB) {
  if (!isConfigured()) {
    throw new Error("RemaData API key is not configured");
  }

  if (!networkType || !volumeInMB) {
    throw new Error("networkType and volumeInMB are required for a RemaData price lookup");
  }

  const response = await axios.post(
    `${getBaseUrl()}/get-cost-price`,
    { networkType, volumeInMB },
    { headers: getHeaders() }
  );

  if (response.data?.status !== "success") {
    throw new Error(response.data?.message || "Failed to fetch RemaData cost price");
  }

  const apiPrice = response.data?.api_price ?? response.data?.data?.api_price;

  if (apiPrice === undefined || apiPrice === null) {
    throw new Error("RemaData cost price response was missing api_price");
  }

  return Number(apiPrice);
}

async function buyData(input) {
  if (!isConfigured()) {
    throw new Error("RemaData API key is not configured");
  }

  const normalized = normalizePurchaseInput(input);

  if (!normalized.networkType || !normalized.phone || !normalized.volumeInMB) {
    throw new Error("RemaData purchase requires networkType, phone, and volumeInMB");
  }

  const response = await axios.post(
    `${getBaseUrl()}/buy-data`,
    {
      ref: normalized.ref,
      phone: normalized.phone,
      volumeInMB: normalized.volumeInMB,
      networkType: normalized.networkType
    },
    {
      headers: getHeaders()
    }
  );

  return response.data;
}

async function getWalletBalance() {
  if (!isConfigured()) {
    throw new Error("RemaData API key is not configured");
  }

  const response = await axios.get(`${getBaseUrl()}/wallet-balance`, {
    headers: getHeaders()
  });

  return response.data;
}

module.exports = {
  isConfigured,
  getBundles,
  getCostPrice,
  buyData,
  getWalletBalance,
  normalizePurchaseInput
};
