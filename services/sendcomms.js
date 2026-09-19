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

function getConfiguredSmsFee() {
  const fee = Number(process.env.SMS_DELIVERY_FEE || 0);
  return Number.isFinite(fee) && fee >= 0 ? fee : 0;
}

function normalizeNetwork(network) {
  if (!network) return null;

  const value = String(network).trim().toLowerCase();

  if (value.includes("mtn")) return "mtn";
  if (value.includes("airteltigo") || value.includes("atgo")) return "airteltigo";
  if (value.includes("telecel") || value.includes("vodafone")) return "telecel";

  return value;
}

function normalizeVolume(volume) {
  if (volume === undefined || volume === null || volume === "") return null;
  if (typeof volume === "number") return volume;

  const text = String(volume).trim().toLowerCase();
  if (!text) return null;
  if (text.endsWith("mb")) return Number(text.replace(/[^\d.]/g, ""));
  if (text.endsWith("gb")) return Number(text.replace(/[^\d.]/g, "")) * 1024;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  return null;
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

function parseSmsPrice(payload) {
  const candidates = [
    payload?.price,
    payload?.amount,
    payload?.cost,
    payload?.data?.price,
    payload?.data?.amount,
    payload?.data?.cost,
    payload?.data?.pricing?.price,
    payload?.data?.pricing?.amount,
    payload?.pricing?.price,
    payload?.pricing?.amount
  ];
  const value = candidates.map(Number).find((item) => Number.isFinite(item) && item >= 0);
  return value === undefined ? null : value;
}

async function getSmsPricing(phone) {
  if (!isConfigured()) return { fee: getConfiguredSmsFee(), source: "configured_default" };
  try {
    const response = await axios.get(`${getBaseUrl()}/sms/pricing`, {
      params: phone ? { phone } : { country_code: "233" },
      headers: getHeaders(),
      timeout: 5000
    });
    const fee = parseSmsPrice(response.data);
    return { fee: fee === null ? getConfiguredSmsFee() : fee, source: fee === null ? "configured_default" : "sendcomms" };
  } catch (error) {
    return { fee: getConfiguredSmsFee(), source: "configured_default" };
  }
}

async function sendSms({ phone, message }) {
  if (!isConfigured()) throw new Error("SendComms SMS is not configured");
  const payload = { to: phone, message };
  if (process.env.SENDCOMMS_SENDER_ID) payload.from = process.env.SENDCOMMS_SENDER_ID;
  const response = await axios.post(`${getBaseUrl()}${process.env.SENDCOMMS_SMS_SEND_PATH || "/sms/send"}`, payload, {
    headers: getHeaders(),
    timeout: 10000
  });
  return response.data;
}

function buildPlanRecord(plan, network) {
  const listedPrice = Number(plan.price?.amount ?? plan.amount ?? plan.total ?? plan.api_price ?? plan.sell_price ?? plan.cost ?? 0);
  const providerPrice = Number(plan.provider_price?.amount ?? plan.cost ?? listedPrice);
  const price = Number.isFinite(providerPrice) && providerPrice > 0 ? providerPrice : listedPrice;
  const fee = Number(plan.fee ?? plan.handling_fee ?? plan.service_fee ?? plan.processing_fee ?? 0);
  const total = Number.isFinite(providerPrice) && providerPrice > 0 ? providerPrice + fee : Number(plan.total ?? price + fee);
  const normalizedNetwork = normalizeNetwork(plan.network || network || "mtn");
  const rawVolume = plan.capacity_gb ?? plan.volume_gb ?? plan.capacity_mb ?? plan.volume ?? plan.data_size ?? plan.bundle_size ?? plan.name ?? 0;
  const volumeText = String(rawVolume).toLowerCase();
  const volumeNumber = Number(String(rawVolume).replace(/[^0-9.]/g, ""));
  const volumeGb = plan.capacity_gb !== undefined || plan.volume_gb !== undefined
    ? volumeNumber
    : volumeText.includes("mb") || plan.capacity_mb !== undefined
      ? volumeNumber / 1024
      : volumeNumber;
  const stableId = `sendcomms:${normalizedNetwork}:${volumeGb}`;

  return {
    ...plan,
    id: plan.id ?? plan.plan_id ?? plan.package_id ?? plan.slug ?? stableId,
    name: plan.name ?? plan.plan_name ?? plan.bundle_name ?? plan.package_name ?? `${plan.volume ?? plan.volume_mb ?? "Bundle"}`,
    network: normalizedNetwork,
    volume: plan.volume ?? plan.volume_mb ?? plan.capacity_gb ?? plan.capacity_mb ?? plan.data_size ?? plan.bundle_size ?? plan.name ?? "Bundle",
    volumeGb,
    price,
    fee,
    total,
    amount: price,
    available: plan.in_stock !== false,
    feeKnown: true,
    feeSource: "provider",
    provider: "sendcomms"
  };
}

function parseRawPlans(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.packages)) return payload.data.packages;
  if (Array.isArray(payload?.packages)) return payload.packages;
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
    timeout: 10000
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

async function getWalletBalance() {
  if (!isConfigured()) throw new Error("SendComms API key or base URL is not configured");

  const response = await axios.get(`${getBaseUrl()}${process.env.SENDCOMMS_WALLET_BALANCE_PATH || "/wallet/balance"}`, {
    headers: getHeaders(),
    timeout: 10000
  });
  return response.data;
}

module.exports = {
  isConfigured,
  getConfiguredSmsFee,
  getSmsPricing,
  sendSms,
  getBundles,
  buyData,
  getPurchaseStatus,
  getWalletBalance,
  normalizePurchaseInput
};
