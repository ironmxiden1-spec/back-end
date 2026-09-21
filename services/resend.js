const axios = require("axios");

async function sendPasswordResetEmail({ email, resetUrl }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "support@wimps.shop").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  await axios.post("https://api.resend.com/emails", {
    from,
    to: [email],
    subject: "Reset your WIMPS password",
    text: `Reset your WIMPS password using this link:\n\n${resetUrl}\n\nThis link expires in 15 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Reset your WIMPS password using the link below.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>`
  }, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    timeout: 12000
  });
}

async function sendCustomerEmail({ recipients, subject, message }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "support@wimps.shop").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const to = [...new Set((Array.isArray(recipients) ? recipients : [recipients])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  if (!to.length) throw new Error("At least one valid customer email is required");
  const escaped = String(message).trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\n/g, "<br>");
  await axios.post("https://api.resend.com/emails", {
    from,
    to,
    subject: String(subject).trim(),
    text: String(message).trim(),
    html: `<p>${escaped}</p>`
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout: 12000
  });
  return { sent: to.length };
}

module.exports = { sendPasswordResetEmail, sendCustomerEmail };
