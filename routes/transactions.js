const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const { createId, isFallback, readTransactions, writeTransactions } = require("../utils/localStore");
const { requireUser } = require("../utils/auth");

router.use(requireUser);

// ===== GET USER TRANSACTIONS =====
router.get("/:email", async (req, res) => {
  try {
    if (req.params.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ msg: "You can only access your own transactions" });
    }

    if (isFallback(req)) {
      const txs = readTransactions()
        .filter((transaction) => transaction.email === req.params.email)
        .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      return res.json(txs);
    }

    const txs = await Transaction.find({ email: req.params.email });
    txs.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    res.json(txs);
  } catch (err) {
    console.error("GET TX ERROR:", err.message);
    res.status(500).json({ msg: "Failed to load transactions" });
  }
});

// ===== CREATE TRANSACTION =====
router.post("/", async (req, res) => {
  try {
    const transactionData = { ...req.body, email: req.user.email };
    if (isFallback(req)) {
      const tx = { ...transactionData, _id: transactionData._id || createId(), date: transactionData.date || new Date().toISOString() };
      const transactions = readTransactions();
      transactions.push(tx);
      writeTransactions(transactions);
      return res.json({ msg: "Transaction saved", tx });
    }

    const tx = new Transaction(transactionData);
    await tx.save();

    res.json({ msg: "Transaction saved", tx });
  } catch (err) {
    console.error("SAVE TX ERROR:", err.message);
    res.status(500).json({ msg: "Failed to save transaction" });
  }
});

module.exports = router;