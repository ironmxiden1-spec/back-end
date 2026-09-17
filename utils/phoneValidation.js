const prefixes = {
  mtn: ["024", "025", "053", "054", "055", "059"],
  airteltigo: ["026", "027", "056", "057"],
  telecel: ["020", "050"]
};

function normalizePhone(value) {
  const compact = String(value || "").replace(/[\s-]/g, "");
  if (compact.startsWith("+233")) return `0${compact.slice(4)}`;
  if (compact.startsWith("233")) return `0${compact.slice(3)}`;
  return compact;
}

function validatePhone(value, network) {
  const phone = normalizePhone(value);
  const allowed = prefixes[String(network || "").toLowerCase()] || [];
  if (!/^0\d{9}$/.test(phone)) return "Enter a valid Ghana mobile number with 10 digits";
  if (!allowed.some((prefix) => phone.startsWith(prefix))) return `The phone number is not valid for ${network}`;
  return null;
}

module.exports = { normalizePhone, validatePhone };
