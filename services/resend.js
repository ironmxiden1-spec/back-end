const axios = require("axios");

const BLOCKED_RECIPIENT_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "admin.admin",
  "test.com",
  "mailinator.com",
  "tempmail.com",
  "yopmail.com"
]);

function normalizeRecipients(recipients) {
  const cleaned = [...new Set((Array.isArray(recipients) ? recipients : [recipients])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))]
    .filter((email) => {
      const domain = email.split("@")[1];
      return !BLOCKED_RECIPIENT_DOMAINS.has(domain);
    });

  if (!cleaned.length) {
    throw new Error("Resend requires a verified recipient address. Use a real customer email on a verified domain or a Resend testing address such as onboarding@resend.dev.");
  }

  return cleaned;
}

function getResendError(error) {
  const providerMessage = error.response?.data?.message || error.response?.data?.error;
  if (providerMessage) {
    const status = error.response.status ? ` (${error.response.status})` : "";
    const message = String(providerMessage);
    if (/invalid `to` field|testing email address|example\.com|not verified|verified domain/i.test(message)) {
      return "Resend requires a verified recipient address. Use a real customer email on a verified domain or a Resend testing address such as onboarding@resend.dev.";
    }
    return `Resend rejected the email${status}: ${message}`;
  }
  return error.message || "Resend email request failed";
}

async function sendPasswordResetEmail({ email, resetUrl }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  try {
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
  } catch (error) {
    throw new Error(getResendError(error));
  }
}

async function sendCustomerEmail({ recipients, subject, message, attachments = [] }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const to = normalizeRecipients(recipients);
  const escaped = String(message).trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\n/g, "<br>");
  const safeAttachments = attachments.map((attachment) => ({
    filename: String(attachment.filename || "image"),
    content: String(attachment.content || "")
  }));
  try {
    await axios.post("https://api.resend.com/emails", {
      from,
      to,
      subject: String(subject).trim(),
      text: String(message).trim(),
      html: `<p>${escaped}</p>`,
      ...(safeAttachments.length ? { attachments: safeAttachments } : {})
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 12000
    });
  } catch (error) {
    throw new Error(getResendError(error));
  }
  return { sent: to.length };
}

module.exports = { sendPasswordResetEmail, sendCustomerEmail };
