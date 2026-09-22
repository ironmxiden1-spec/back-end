const axios = require("axios");

function getResendError(error) {
  const providerMessage = error.response?.data?.message || error.response?.data?.error;
  if (providerMessage) {
    const status = error.response.status ? ` (${error.response.status})` : "";
    return `Resend rejected the email${status}: ${providerMessage}`;
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
  const to = [...new Set((Array.isArray(recipients) ? recipients : [recipients])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  if (!to.length) throw new Error("At least one valid customer email is required");
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
