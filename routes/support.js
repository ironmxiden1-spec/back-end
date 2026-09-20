const express = require("express");
const axios = require("axios");
const Transaction = require("../models/Transaction");
const { isFallback, readTransactions, writeTransactions, createId } = require("../utils/localStore");
const router = express.Router();

router.post("/donate", async (req, res) => {
  try {
    const { reference, amount, email } = req.body || {};

    if (!reference || !amount || !email || !process.env.PAYSTACK_SECRET_KEY) {
      return res.status(400).json({ msg: "reference, amount, and email are required" });
    }

    const verification = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      timeout: 10000
    });
    const payment = verification.data?.data || {};
    if (verification.data?.status !== true || payment.status !== "success" || Math.abs(Number(payment.amount || 0) / 100 - Number(amount)) > 0.01) {
      return res.status(400).json({ msg: "Support payment could not be verified" });
    }

    const record = {
      email,
      type: "support",
      amount: Number(amount),
      paymentMethod: "paystack",
      reference,
      status: "completed",
      date: new Date(),
      deliveredAt: new Date()
    };
    if (isFallback(req)) {
      const transactions = readTransactions();
      if (!transactions.some((item) => item.reference === reference)) {
        transactions.push({ _id: createId(), ...record, date: new Date().toISOString(), deliveredAt: new Date().toISOString() });
        writeTransactions(transactions);
      }
    } else if (!(await Transaction.exists({ reference }))) {
      await Transaction.create(record);
    }

    return res.json({
      msg: "Donation recorded successfully",
      data: {
        reference,
        amount: Number(amount),
        email,
        status: "received"
      }
    });
  } catch (error) {
    console.error("SUPPORT DONATE ERROR:", error.message);
    return res.status(500).json({ msg: "Unable to record donation" });
  }
});

module.exports = router;
