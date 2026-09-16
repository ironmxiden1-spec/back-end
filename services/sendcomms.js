const axios = require("axios");

function getBaseUrl() {
  return process.env.SENDCOMMS_API_BASE_URL || process.env.SENDCOMMS_BASE_URL || "https://api.sendcomms.com/api/v1";
}

function getApiKey() {
  return process.env.SENDCOMMS_API_KEY || process.env.SENDCOMMS_KEY || "";
}

function isConfigured() {
  return Boolean(getApiKey());
}

function normalizeNetwork(network) {
  if (!network) return null;

  const value = String(network).trim().toLowerCase();

  if (value.includes("mtn")) return "mtn";
  if (value.includes("airteltigo") || value.includes("atgo")) return "airteltigo";
  if (value.includes("telecel") || value.includes("vodafone")) return "telecel";

  return value;
}

function normalizePurchaseInput(body = {}) {
  const networkType = normalizeNetwork(
    body.networkType || body.network || body.network_name || body.providerNetwork
  );

  const phone = body.phone || body.phoneNumber || body.recipientPhone || body.msisdn;
  const rawVolume = body.volumeInMB ?? body.volume ?? body.capacity ?? body.bundle_size ?? body.bundle;
  const volumeInMB = normalizeVolume(rawVolume);

  const ref = body.ref || body.reference || `WIMPS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    networkType,
    phone,
    volumeInMB,
    ref
  };
}

function getHeaders() {
  const apiKey = getApiKey();
  return {
    "Content-Type": "application/json",
    ...(apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
          "X-API-KEY": apiKey
        }
      : {})
  };
}

function buildPlanRecord(plan, network) {
  const price = Number(plan.price ?? plan.amount ?? plan.total ?? plan.api_price ?? 0);
  const fee = Number(plan.fee ?? plan.handling_fee ?? plan.service_fee ?? plan.processing_fee ?? 0);
  const total = Number(plan.total ?? price + fee);
  const normalizedNetwork = normalizeNetwork(plan.network || network || "mtn");
  const volumeGb = Number(plan.capacity_gb ?? (plan.capacity_mb !== undefined ? Number(plan.capacity_mb) / 1024 : plan.volume_gb ?? plan.volume ?? 0));
  const stableId = `sendcomms:${normalizedNetwork}:${volumeGb}`;

  return {
    ...plan,
    id: plan.id ?? plan.plan_id ?? plan.slug ?? stableId,
    name: plan.name ?? plan.plan_name ?? plan.bundle_name ?? `${plan.volume ?? plan.volume_mb ?? "Bundle"}`,
    network: normalizedNetwork,
    volume: plan.volume ?? plan.volume_mb ?? plan.capacity_gb ?? plan.capacity_mb ?? plan.data_size ?? plan.name ?? "Bundle",
    volumeGb,
    price,
    fee,
    total,
    amount: price,
    available: plan.in_stock !== false,
    provider: "sendcomms"
  };
}

function parseRawPlans(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.plans)) return payload.plans;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

async function getBundles(network) {
  if (!isConfigured()) {
    throw new Error("SendComms API key or base URL is not configured");
  }

  const normalizedNetwork = normalizeNetwork(network);
  const response = await axios.get(`${getBaseUrl()}/data/packages`, {
    params: normalizedNetwork ? { network: normalizedNetwork } : {},
    headers: getHeaders(),
    timeout: 2500
  });

  const networks = response.data?.data?.networks;
  if (networks && typeof networks === "object") {
    const selected = normalizedNetwork ? networks[normalizedNetwork] || [] : Object.values(networks).flat();
    return selected.map((plan) => buildPlanRecord(plan, normalizedNetwork || plan.network));
  }

  return parseRawPlans(response.data).map((plan) => buildPlanRecord(plan, normalizedNetwork || network));
}

async function buyData(input) {
  if (!isConfigured()) {
    throw new Error("SendComms API key or base URL is not configured");
  }

  const normalized = normalizePurchaseInput(input);

  if (!normalized.networkType || !normalized.phone || !normalized.volumeInMB) {
    throw new Error("SendComms purchase requires networkType, phone, and volumeInMB");
  }

  const response = await axios.post(
    `${getBaseUrl()}/data/purchase`,
    {
      phone_number: normalized.phone,
      network: normalized.networkType,
      capacity_gb: normalized.volumeInMB / 1024,
      reference: normalized.ref,
      idempotency_key: normalized.ref
    },
    { headers: getHeaders() }
  );

  return response.data;
}

async function getPurchaseStatus({ transactionId, reference } = {}) {
  if (!isConfigured()) {
    throw new Error("SendComms API key or base URL is not configured");
  }

  if (!transactionId && !reference) {
    throw new Error("transactionId or reference is required");
  }

  const response = await axios.get(`${getBaseUrl()}/data/purchase`, {
    params: transactionId ? { transaction_id: transactionId } : { reference },
    headers: getHeaders()
  });

  return response.data;
}

module.exports = {
  isConfigured,
  getBundles,
  buyData,
  getPurchaseStatus,
  normalizePurchaseInput
};
