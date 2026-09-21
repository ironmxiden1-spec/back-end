const express = require("express");
const router = express.Router();
const User = require("../models/user");
const crypto = require("crypto");
const axios = require("axios");
const { createId, isFallback, readUsers, writeUsers } = require("../utils/localStore");
const { createAuthToken, requireUser } = require("../utils/auth");
const AdminSetting = require("../models/AdminSetting");
const { readData } = require("../utils/fileDb");

async function getDataPurgeNotice(req) {
  try {
    const record = isFallback(req)
      ? (readData("admin-settings.json") || []).find((item) => item.key === "lastDataPurge")
      : await AdminSetting.findOne({ key: "lastDataPurge" }).lean();
    return record?.value?.notice || "";
  } catch (error) {
    return "";
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (!storedPassword.startsWith("scrypt:")) {
    return password === storedPassword;
  }

  const [, salt, expectedHash] = storedPassword.split(":");
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function makeReferralCode(user) {
  const source = String(user._id || user.id || crypto.randomBytes(5).toString("hex"));
  return `WIMPS-${source.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
}

async function getReferralReward(req) {
  try {
    const record = isFallback(req)
      ? (readData("admin-settings.json") || []).find((item) => item.key === "referralReward")
      : await AdminSetting.findOne({ key: "referralReward" }).lean();
    const value = Number(record?.value);
    return Number.isFinite(value) && value >= 0 ? value : 0.1;
  } catch (error) {
    return 0.1;
  }
}

function publicUser(user) {
  return {
    id: user._id || user.id,
    fullname: user.fullname,
    email: user.email,
    balance: user.balance || 0,
    referralCode: user.referralCode || makeReferralCode(user),
    referralCount: Number(user.referralCount || 0),
    referralCredits: Number(user.referralCredits || 0),
    createdAt: user.createdAt,
    googleId: user.googleId || "",
    authToken: createAuthToken(user)
  };
}

router.get("/config", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || ""
  });
});

router.get("/session", requireUser, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

// ===== REGISTER =====
router.post("/register", async (req, res) => {
  try {
    const { fullname, email, password, referralCode } = req.body;

    if (!fullname || !email || !password) {
      return res.status(400).json({ msg: "All fields required" });
    }

    if (isFallback(req)) {
      const users = readUsers();
      const exists = users.find((item) => item.email.toLowerCase() === email.toLowerCase());
      if (exists) return res.status(400).json({ msg: "User already exists" });

      const user = {
        id: createId(),
        fullname,
        email: email.toLowerCase(),
        password: hashPassword(password),
        balance: 0,
        referralCode: `WIMPS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
        referredBy: "",
        referralCount: 0,
        referralCredits: 0,
        createdAt: new Date().toISOString()
      };
      const referrer = users.find((item) => String(item.referralCode || "").toUpperCase() === String(referralCode || "").trim().toUpperCase());
        const reward = await getReferralReward(req);
      if (referrer && referrer.email !== user.email) {
        user.referredBy = referrer.referralCode;
        referrer.referralCount = Number(referrer.referralCount || 0) + 1;
        referrer.referralCredits = Number((Number(referrer.referralCredits || 0) + reward).toFixed(2));
        referrer.balance = Number((Number(referrer.balance || 0) + reward).toFixed(2));
      }
      users.push(user);
      writeUsers(users);
      return res.json({ msg: "Registration successful", user: publicUser(user) });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const user = new User({
      fullname,
      email,
      password: hashPassword(password),
      balance: 0,
      referralCode: `WIMPS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
      referralCount: 0,
      referralCredits: 0
    });

    const referrer = referralCode
      ? await User.findOne({ referralCode: String(referralCode).trim().toUpperCase() })
      : null;
    if (referrer && referrer.email.toLowerCase() !== email.toLowerCase()) {
        const reward = await getReferralReward(req);
      user.referredBy = referrer.referralCode;
      referrer.referralCount += 1;
      referrer.referralCredits = Number((Number(referrer.referralCredits || 0) + reward).toFixed(2));
      referrer.balance = Number((Number(referrer.balance || 0) + reward).toFixed(2));
      await referrer.save();
    }

    await user.save();

    res.json({ msg: "Registration successful", user: publicUser(user) });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ===== LOGIN =====
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;

    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    if (isFallback(req)) {
      const users = readUsers();
      const user = users.find((item) => item.email.toLowerCase() === email);
      if (!user || !verifyPassword(password, user.password)) {
        return res.status(400).json({ msg: "Invalid credentials", notice: await getDataPurgeNotice(req) });
      }
      if (!user.password.startsWith("scrypt:")) {
        user.password = hashPassword(password);
        writeUsers(users);
      }
      return res.json({ msg: "Login successful", user: publicUser(user) });
    }

    const user = await User.findOne({ email });

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(400).json({ msg: "Invalid credentials", notice: await getDataPurgeNotice(req) });
    }

    if (user.password && !user.password.startsWith("scrypt:")) {
      user.password = hashPassword(password);
      await user.save();
    }

    res.json({ msg: "Login successful", user: publicUser(user) });

  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential || !process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({ msg: "Google sign-in is not configured" });
    }

    const googleResponse = await axios.get("https://oauth2.googleapis.com/tokeninfo", {
      params: { id_token: credential }
    });
    const profile = googleResponse.data || {};

    if (profile.aud !== process.env.GOOGLE_CLIENT_ID || profile.email_verified !== "true" || !profile.email) {
      return res.status(401).json({ msg: "Invalid Google account" });
    }

    const email = profile.email.toLowerCase();
    let user;
    if (isFallback(req)) {
      const users = readUsers();
      user = users.find((item) => item.email.toLowerCase() === email);
      if (!user) {
        user = { id: createId(), fullname: profile.name || email.split("@")[0], email, password: "", googleId: profile.sub, balance: 0, createdAt: new Date().toISOString() };
        users.push(user);
      } else if (!user.googleId) {
        user.googleId = profile.sub;
      }
      writeUsers(users);
    } else {
      user = await User.findOne({ email });
      if (!user) {
        user = await User.create({ fullname: profile.name || email.split("@")[0], email, password: "", googleId: profile.sub, balance: 0 });
      } else if (!user.googleId) {
        user.googleId = profile.sub;
        await user.save();
      }
    }

    res.json({ msg: "Google sign-in successful", user: publicUser(user) });
  } catch (err) {
    console.error("GOOGLE AUTH ERROR:", err.response?.data || err.message);
    res.status(401).json({ msg: "Google sign-in failed" });
  }
});

module.exports = router;