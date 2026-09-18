const express = require("express");
const router = express.Router();
const axios = require("axios");

const User = require("../models/user");
const Transaction = require("../models/Transaction");
const { placeProviderOrder, getPlans, getFallbackPlans } = require("../services/resellerxpress");
const { createId, isFallback, readUsers, writeUsers, readTransactions, writeTransactions } = require("../utils/localStore");
const { requireUser } = require("../utils/auth");
const { normalizePhone, validatePhone } = require("../utils/phoneValidation");

router.use(requireUser);

async function verifyPaystackReference(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { verified: false, msg: "PAYSTACK_SECRET_KEY is not configured" };
  }

  try {
    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paymentData = verifyRes.data?.data || {};
    const isVerified = paymentData.status === "success" && verifyRes.data?.status === true;

    if (!isVerified) {
      return {
        verified: false,
        msg: paymentData.status || verifyRes.data?.message || "Payment not verified"
      };
    }

    return {
      verified: true,
      paymentData
    };
  } catch (err) {
    return {
      verified: false,
      msg: err.response?.data?.message || err.message || "Payment verification failed"
    };
  }
}

function validatePayment(paymentData, expectedAmount) {
  const expected = Number(expectedAmount);
  const paidAmount = Number(paymentData.amount || 0) / 100;
  const currency = String(paymentData.currency || "").toUpperCase();

  if (!Number.isFinite(expected) || expected <= 0) return "Invalid expected payment amount";
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return "Invalid payment amount";
  if (currency && currency !== "GHS") return "Payment currency mismatch";
  if (Math.abs(paidAmount - expected) > 0.01) return "Amount mismatch";
  return null;
}

// ==========================
// GET WALLET BALANCE
// ==========================
router.get("/:email", async (req, res) => {
  try {
    if (req.params.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ msg: "You can only access your own wallet" });
    }

    if (isFallback(req)) {
      const user = readUsers().find((item) => item.email.toLowerCase() === req.params.email.toLowerCase());
      if (!user) return res.status(404).json({ msg: "User not found" });
      return res.json({ balance: user.balance || 0 });
    }

    const user = await User.findOne({ email: req.params.email });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({ balance: user.balance || 0 });

  } catch (err) {
    console.error("GET WALLET ERROR:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});


// ==========================
// PAYSTACK DEPOSIT (SECURE)
// ==========================
router.post("/deposit", async (req, res) => {
  try {
    const { amount, reference } = req.body;
    const email = req.user.email;

    console.log("DEPOSIT REQUEST:", req.body);

    if (!email || !amount || !reference) {
      return res.status(400).json({ msg: "Missing fields" });
    }

    const verification = await verifyPaystackReference(reference);

    console.log("PAYSTACK RESPONSE:", verification);

    if (!verification.verified) {
      return res.status(400).json({ msg: verification.msg || "Payment not verified" });
    }

    const paymentData = verification.paymentData;

    const paymentError = validatePayment(paymentData, amount);
    if (paymentError) return res.status(400).json({ msg: paymentError });

    if (isFallback(req)) {
      const users = readUsers();
      const user = users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
      if (!user) return res.status(404).json({ msg: "User not found" });

      const transactions = readTransactions();
      const existing = transactions.find((item) => item.reference === reference);
      if (existing) return res.json({ msg: "Deposit already processed", balance: user.balance || 0 });

      const paidAmount = Number(paymentData.amount) / 100;
      user.balance = Number(user.balance || 0) + paidAmount;
      transactions.push({
        _id: createId(), email, type: "deposit", amount: paidAmount,
        paymentMethod: "paystack", reference, status: "completed", date: new Date().toISOString(), deliveredAt: new Date().toISOString()
      });
      writeUsers(users);
      writeTransactions(transactions);
      return res.json({ msg: "Deposit successful", balance: user.balance });
    }

    // ✅ PREVENT DOUBLE CREDIT
    const existing = await Transaction.findOne({ reference });
    if (existing) {
      if (existing.email === email && existing.type === "deposit" && existing.status === "completed") {
        const currentUser = await User.findOne({ email });
        return res.json({ msg: "Deposit already processed", balance: currentUser?.balance || 0 });
      }
      return res.status(409).json({ msg: "Payment reference already used" });
    }

    // ✅ FIND USER
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // ✅ CONVERT KOBO → GHS
    const paidAmount = Number(paymentData.amount) / 100;

    // ✅ CREDIT WALLET
    user.balance += paidAmount;
    await user.save();

    // ✅ SAVE TRANSACTION
    await Transaction.create({
      email,
      type: "deposit",
      amount: paidAmount,
      paymentMethod: "paystack",
      reference,
      status: "completed",
      date: new Date(),
      deliveredAt: new Date()
    });

    res.json({
      msg: "Deposit successful",
      balance: user.balance
    });

  } catch (err) {
    console.error("DEPOSIT ERROR:", err.response?.data || err.message);
    res.status(500).json({ msg: "Deposit failed" });
  }
});


// ==========================
// BUY / DEDUCT WALLET
// ==========================
router.post("/buy", async (req, res) => {
  try {
    const incoming = req.body || {};
    const { amount, bundle, phone, reference } = incoming;
    const email = req.user.email;

    const phoneError = validatePhone(phone, incoming.network || incoming.networkType);
    if (phoneError) return res.status(400).json({ msg: phoneError });
    incoming.phone = normalizePhone(phone);

    if (isFallback(req)) {
      const users = readUsers();
      const user = users.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
      if (!user) return res.status(404).json({ msg: "User not found" });

      const plansResponse = isFallback(req)
        ? getFallbackPlans(incoming.network || incoming.networkType)
        : await getPlans(incoming.network || incoming.networkType);
      const plans = Array.isArray(plansResponse) ? plansResponse : (plansResponse?.data || []);
      const plan = plans.find((item) => String(item.id) === String(incoming.plan_id ?? incoming.planId));
      if (!plan) return res.status(409).json({ msg: "Selected bundle is no longer available" });

      const sellingPrice = Number(plan.sellingPrice || (Number(plan.cost || plan.total || 0) + 1));
      const requiredAmount = sellingPrice * Math.max(Number(incoming.quantity || 1), 1);
      if (!requiredAmount) return res.status(400).json({ msg: "Invalid bundle amount" });

      if (reference) {
        const verification = await verifyPaystackReference(reference);
        if (!verification.verified) return res.status(400).json({ msg: verification.msg || "Payment verification failed" });
        const paymentError = validatePayment(verification.paymentData, requiredAmount);
        if (paymentError) return res.status(400).json({ msg: paymentError });
        const duplicate = readTransactions().find((item) => item.reference === reference);
        if (duplicate) return res.json({ msg: "Payment already processed", balance: user.balance || 0, data: duplicate });
      } else {
        if (Number(user.balance || 0) < requiredAmount) return res.status(400).json({ msg: "Insufficient balance" });
        user.balance = Number(user.balance || 0) - requiredAmount;
      }

      const transaction = {
        _id: createId(), email, amount: requiredAmount, bundle: bundle || plan.name,
        phone, paymentMethod: reference ? "paystack" : "wallet",
        status: reference ? "pending" : "completed", reference: reference || createId(),
        date: new Date().toISOString()
      };
      const transactions = readTransactions();
      transactions.push(transaction);
      writeUsers(users);
      writeTransactions(transactions);
      return res.json({
        msg: reference ? "Payment verified; bundle processing" : "Bundle purchase successful",
        balance: user.balance || 0,
        data: transaction
      });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const hasResellerPayload = Boolean(
      incoming.plan_id !== undefined ||
      incoming.planId !== undefined ||
      incoming.request_id !== undefined ||
      incoming.requestId !== undefined ||
      incoming.quantity !== undefined
    );

    if (hasResellerPayload) {
      const planId = incoming.plan_id ?? incoming.planId;
      const phone = incoming.phone ?? incoming.phoneNumber;
      const requestId = incoming.request_id ?? incoming.requestId ?? `WIMPS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const quantity = Number(incoming.quantity ?? 1);

      if (!planId || !phone) {
        return res.status(400).json({
          msg: "Invalid ResellerXpress payload. Required: plan_id and phone"
        });
      }

      const plansResponse = await getPlans(incoming.network || incoming.networkType || incoming.network_name || incoming.providerNetwork);
      const plans = Array.isArray(plansResponse) ? plansResponse : (plansResponse?.data || []);
      const plan = plans.find((item) => String(item.id) === String(planId));

      if (!plan) {
        return res.status(409).json({ msg: "Selected bundle is no longer available" });
      }

      if (plan.provider === "resellerxpress" && !/^\d+$/.test(String(plan.id))) {
        return res.status(503).json({
          msg: "Live bundle plans are temporarily unavailable. Please try again later."
        });
      }

      if (plan.purchasable === false) {
        return res.status(503).json({
          msg: "Live bundle plans are temporarily unavailable. Please try again later."
        });
      }

      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const requiredAmount = Number(plan.sellingPrice || 0) * safeQuantity;
      const providerCost = Number(plan.cost || plan.total || 0) * safeQuantity;
      const expectedProfit = Number(plan.expectedProfit || 0) * safeQuantity;

      if (!requiredAmount || plan.available === false || requiredAmount < providerCost) {
        return res.status(400).json({
          msg: "No valid amount could be derived for this ResellerXpress plan"
        });
      }

      if (reference) {
        const verification = await verifyPaystackReference(reference);

        if (!verification.verified) {
          return res.status(400).json({ msg: verification.msg || "Payment verification failed" });
        }

        const paymentError = validatePayment(verification.paymentData, requiredAmount);
        if (paymentError) return res.status(400).json({ msg: paymentError });

        const existing = await Transaction.findOne({ reference });
        if (existing) {
          if (existing.status === "completed") {
            return res.json({ msg: "Payment already processed", balance: user.balance || 0, data: existing });
          }
          return res.status(409).json({ msg: "Payment is already being processed" });
        }
      } else {
        if (user.balance < requiredAmount) {
          return res.status(400).json({ msg: "Insufficient balance" });
        }

        user.balance -= requiredAmount;
        await user.save();
      }

      const tx = await Transaction.create({
        email,
        amount: requiredAmount,
        providerCost,
        providerFee: Number(plan.fee || 0) * safeQuantity,
        expectedProfit,
        bundle: bundle || plan?.name || `${quantity} bundle(s)`,
        phone,
        paymentMethod: reference ? "paystack" : "wallet",
        status: "pending",
        reference: reference || requestId
      });

      try {
        const result = await placeProviderOrder(plan.provider, {
          plan_id: planId,
          phone,
          network: plan.network,
          volumeGb: plan.volumeGb || plan.volume,
          request_id: requestId,
          quantity
        });

        const providerStatus = String(
          result?.data?.delivery_status || result?.data?.fulfillment_status ||
          result?.delivery_status || result?.fulfillment_status ||
          result?.data?.status || result?.status || result?.order?.status || "pending"
        ).toLowerCase();
        const confirmedDeliveryStatuses = ["completed", "delivered", "sent", "delivered_successfully"];
        tx.status = confirmedDeliveryStatuses.includes(providerStatus)
          ? "completed"
          : providerStatus === "failed" ? "failed" : "pending";
        tx.actualProfit = Number((requiredAmount - providerCost - Number(plan.fee || 0) * safeQuantity).toFixed(2));
        if (tx.status === "completed") tx.deliveredAt = new Date();
        // Keep the Paystack reference stable so a callback retry cannot deliver twice.
        if (!reference) tx.reference = result?.order?.request_id || requestId;
        await tx.save();

        return res.json({
          msg: tx.status === "completed"
            ? "Bundle delivery confirmed by the provider"
            : tx.status === "failed"
              ? "The provider could not deliver this bundle"
              : "Payment accepted; your bundle is being delivered",
          balance: user.balance || 0,
          data: result
        });
      } catch (apiErr) {
        console.error("RESELLERXPRESS ERROR:", apiErr.response?.data || apiErr.message);

        tx.status = "failed";
        await tx.save();

        if (!reference) {
          user.balance += requiredAmount;
          await user.save();
        }

        return res.status(500).json({
          msg: apiErr.response?.data?.message || apiErr.message || "ResellerXpress delivery failed, refunded"
        });
      }
    }

    return res.status(400).json({
      msg: "A provider plan is required. Use plan_id, phone, and network for bundle purchases."
    });

  } catch (err) {
    console.error("BUY ERROR:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});
module.exports = router;