const express = require("express");
const crypto = require("crypto");
const WebhookEvent = require("../models/WebhookEvent");
const Transaction = require("../models/Transaction");

const router = express.Router();

function verifyPaystackSignature(req) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.get("x-paystack-signature");
  if (!secret || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac("sha512", secret).update(req.rawBody).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

router.post("/paystack/webhook", async (req, res) => {
  if (!verifyPaystackSignature(req)) return res.status(401).json({ msg: "Invalid Paystack signature" });

  const event = req.body || {};
  const eventId = String(event.data?.id || event.data?.reference || crypto.createHash("sha256").update(req.rawBody).digest("hex"));

  try {
    await WebhookEvent.create({ provider: "paystack", eventId, event: event.event || "unknown", payload: event });
  } catch (error) {
    if (error.code === 11000) return res.status(200).json({ received: true, duplicate: true });
    console.error("PAYSTACK WEBHOOK STORE ERROR:", error.message);
    return res.status(500).json({ msg: "Webhook could not be stored" });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    try {
      await Transaction.updateOne(
        { reference: event.data.reference },
        { $set: { status: "payment_verified", paymentFee: Number(event.data.fees || 0) / 100 } }
      );
    } catch (error) {
      console.error("PAYSTACK TRANSACTION UPDATE ERROR:", error.message);
    }
  }

  return res.status(200).json({ received: true });
});

module.exports = router;
