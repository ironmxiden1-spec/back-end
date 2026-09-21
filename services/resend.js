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

module.exports = { sendPasswordResetEmail };
