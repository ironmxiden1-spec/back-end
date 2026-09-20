const axios = require("axios");

function getBaseUrl() {
  if (process.env.RELOADLY_BASE_URL) return process.env.RELOADLY_BASE_URL;
  return String(process.env.RELOADLY_ENV || "production").toLowerCase() === "sandbox"
    ? "https://topups-sandbox.reloadly.com"
    : "https://topups.reloadly.com";
}

function getAuthUrl() {
  return process.env.RELOADLY_AUTH_URL || "https://auth.reloadly.com/oauth/token";
}

function getClientId() {
  return String(process.env.RELOADLY_CLIENT_ID || "").trim();
}

function getClientSecret() {
  return String(process.env.RELOADLY_CLIENT_SECRET || "").trim();
}

function getConfiguredAccessToken() {
  return String(process.env.RELOADLY_ACCESS_TOKEN || "").trim();
}

function getCountryCode() {
  return String(process.env.RELOADLY_COUNTRY_CODE || "GH").trim().toUpperCase();
}

function isConfigured() {
  return Boolean(getConfiguredAccessToken() || (getClientId() && getClientSecret()));
}

let tokenCache = { value: "", expiresAt: 0 };

async function getAccessToken() {
  if (!isConfigured()) throw new Error("Reloadly client credentials are not configured");
  if (getConfiguredAccessToken()) return getConfiguredAccessToken();
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;

  const response = await axios.post(getAuthUrl(), {
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "client_credentials",
    audience: getBaseUrl()
  }, { timeout: 10000 });

  const token = response.data?.access_token;
  if (!token) throw new Error("Reloadly authentication did not return an access token");
  tokenCache = { value: token, expiresAt: Date.now() + Number(response.data.expires_in || 3600) * 1000 };
  return token;
}

async function request(method, path, options = {}) {
  const token = await getAccessToken();
  return axios({
    method,
    url: `${getBaseUrl()}${path}`,
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    timeout: options.timeout || 12000
  });
}

function normalizeNetwork(network) {
  const value = String(network || "").toLowerCase();
  if (value.includes("mtn")) return "mtn";
  if (value.includes("telecel") || value.includes("vodafone")) return "telecel";
  if (value.includes("airteltigo") || value.includes("airtel-tigo") || value.includes("atgo")) return "airteltigo";
  return value;
}

function parseVolumeGb(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(gb|mb)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2].toLowerCase() === "mb" ? amount / 1024 : amount;
}

function collectBundleCandidates(operator) {
  const candidates = [
    ...(Array.isArray(operator.dataBundles) ? operator.dataBundles : []),
    ...(Array.isArray(operator.bundles) ? operator.bundles : []),
    ...(Array.isArray(operator.data) ? operator.data : [])
  ];
  const descriptions = operator.localFixedAmountsDescriptions || operator.fixedAmountsDescriptions || {};
  const amounts = operator.localFixedAmounts || operator.fixedAmounts || [];
  Object.entries(descriptions).forEach(([amount, description]) => {
    candidates.push({ amount: Number(amount), description });
  });
  return candidates.length ? candidates : [operator];
}

function normalizePlan(operator, bundle, network) {
  const label = bundle.name || bundle.description || bundle.bundleName || bundle.data || bundle.amountDescription || "";
  const volumeGb = Number(bundle.volumeGb || bundle.volume_gb || parseVolumeGb(label) || 0);
  const amount = Number(bundle.localAmount ?? bundle.amount ?? bundle.price ?? bundle.localPrice ?? 0);
  const operatorId = operator.operatorId || operator.id;
  return {
    id: `reloadly:${operatorId}:${bundle.id || bundle.bundleId || volumeGb}:${amount}`,
    provider: "reloadly",
    operatorId,
    network: normalizeNetwork(network || operator.name),
    operatorName: operator.name,
    name: label || `${volumeGb}GB ${operator.name || "Data"}`,
    volume: volumeGb ? `${volumeGb}GB` : label,
    volumeGb,
    price: amount,
    total: amount,
    cost: amount,
    fee: 0,
    amount,
    available: bundle.available !== false && bundle.status !== "inactive",
    purchasable: Boolean(operatorId && amount > 0 && volumeGb >= 1),
    feeKnown: true,
    reloadlyBundleId: bundle.id || bundle.bundleId || null,
    destinationCurrencyCode: operator.destinationCurrencyCode || operator.country?.currencyCode || "GHS"
  };
}

async function getOperators() {
  const response = await request("get", `/operators/countries/${getCountryCode()}`, {
     params: { includeBundles: true, includeData: true, includeCombo: false, bundlesOnly: false, dataOnly: false, size: 200 }
  });
  const payload = response.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.content)) return payload.content;
  if (payload?.example && typeof payload.example === "object") return [payload.example];
  return payload?.id || payload?.operatorId ? [payload] : [];
}

async function getBundles(network) {
  if (!isConfigured()) throw new Error("Reloadly client credentials are not configured");
  const normalizedNetwork = normalizeNetwork(network);
  const operators = await getOperators();
  return operators
    .filter((operator) => !normalizedNetwork || normalizeNetwork(operator.name) === normalizedNetwork)
    .flatMap((operator) => {
      const descriptions = operator.localFixedAmountsDescriptions || operator.fixedAmountsDescriptions || {};
      const candidates = Object.entries(descriptions).map(([amount, description]) => ({ amount: Number(amount), description }));
      const source = candidates.length ? candidates : collectBundleCandidates(operator);
      return source.map((bundle) => normalizePlan(operator, bundle, normalizedNetwork));
    })
    .filter((plan) => Number(plan.volumeGb) >= 1 && Number(plan.price) > 0);
}

async function getWalletBalance() {
  const response = await request("get", "/accounts/balance");
  return response.data;
}

async function buyData({ phone, network, amount, operatorId, reference }) {
  if (!phone || !operatorId || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error("Reloadly purchase requires phone, operatorId, and amount");
  }
  const digits = String(phone).replace(/^\+/, "").replace(/^0/, "233");
  const response = await request("post", "/topups", {
    data: {
      amount: Number(amount).toFixed(2),
      operatorId: Number(operatorId),
      customIdentifier: reference,
      useLocalAmount: true,
      recipientPhone: { countryCode: getCountryCode(), number: digits }
    }
  });
  return response.data;
}

async function getBundles(network) {
  if (!isConfigured()) throw new Error("Reloadly client credentials are not configured");
  const normalizedNetwork = normalizeNetwork(network);
  const response = await request("get", `/operators/countries/${getCountryCode()}`, {
    params: { includeBundles: true, includeData: true, includeCombo: false, bundlesOnly: false, dataOnly: false, size: 200 }
  });
  const operators = Array.isArray(response.data) ? response.data : response.data?.content || [];
  return operators
    .filter((operator) => !normalizedNetwork || normalizeNetwork(operator.name) === normalizedNetwork)
    .flatMap((operator) => Object.entries(operator.localFixedAmountsDescriptions || operator.fixedAmountsDescriptions || {}).map(([amount, description]) => normalizePlan(operator, { amount: Number(amount), description }, normalizedNetwork)))
    .filter((plan) => Number(plan.volumeGb) >= 1 && Number(plan.price) > 0);
}

module.exports = { isConfigured, getBundles, getWalletBalance, buyData, normalizeNetwork, getOperators, collectBundleCandidates, normalizePlan };
