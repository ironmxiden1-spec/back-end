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

function publicUser(user) {
  return {
    id: user._id || user.id,
    fullname: user.fullname,
    email: user.email,
    balance: user.balance || 0,
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
    const { fullname, email, password } = req.body;

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
        createdAt: new Date().toISOString()
      };
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
      balance: 0
    });

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