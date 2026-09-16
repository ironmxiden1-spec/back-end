const express = require("express");
const router = express.Router();
const User = require("../models/user");
const crypto = require("crypto");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { createId, isFallback, readUsers, writeUsers } = require("../utils/localStore");
const { createAuthToken } = require("../utils/auth");

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

const DEMO_ACCOUNTS = {
  "test@mail.com": { fullname: "Test User", password: "123456" },
  "mark@gmail.com": { fullname: "mark nine", password: "123456" }
};

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

function getMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendResetEmail(email, resetUrl) {
  const mailer = getMailer();
  if (!mailer) throw new Error("Password reset email is not configured");

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Reset your WIMPS password",
    text: `Use this link to change your WIMPS password. It expires in 30 minutes:\n\n${resetUrl}`,
    html: `<p>Use the link below to change your WIMPS password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p>`
  });
}

router.get("/config", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || ""
  });
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

    if (isFallback(req)) {
      const users = readUsers();
      const user = users.find((item) => item.email.toLowerCase() === email);
      if (!user || !verifyPassword(password, user.password)) {
        return res.status(400).json({ msg: "Invalid credentials" });
      }
      if (!user.password.startsWith("scrypt:")) {
        user.password = hashPassword(password);
        writeUsers(users);
      }
      return res.json({ msg: "Login successful", user: publicUser(user) });
    }

    let user = await User.findOne({ email });

    if (!user && DEMO_ACCOUNTS[email]?.password === password) {
      user = await User.create({
        fullname: DEMO_ACCOUNTS[email].fullname,
        email,
        password: hashPassword(password),
        balance: 0
      });
    }

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(400).json({ msg: "Invalid credentials" });
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

    let user = await User.findOne({ email: profile.email.toLowerCase() });
    if (!user) {
      user = await User.create({
        fullname: profile.name || profile.email.split("@")[0],
        email: profile.email.toLowerCase(),
        password: "",
        googleId: profile.sub,
        balance: 0
      });
    } else if (!user.googleId) {
      user.googleId = profile.sub;
      await user.save();
    }

    res.json({ msg: "Google sign-in successful", user: publicUser(user) });
  } catch (err) {
    console.error("GOOGLE AUTH ERROR:", err.response?.data || err.message);
    res.status(401).json({ msg: "Google sign-in failed" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ msg: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) return res.json({ msg: "If an account exists, a reset email has been sent" });

    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5500/front-end";
    await sendResetEmail(email, `${baseUrl}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`);

    res.json({ msg: "If an account exists, a reset email has been sent" });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err.message);
    res.status(503).json({ msg: "Password reset email is currently unavailable" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, password } = req.body || {};
    if (!email || !token || !password || password.length < 6) {
      return res.status(400).json({ msg: "Email, token, and a password of at least 6 characters are required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email: String(email).trim().toLowerCase(),
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ msg: "Reset link is invalid or expired" });

    user.password = hashPassword(password);
    user.resetPasswordTokenHash = "";
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ msg: "Password changed successfully" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err.message);
    res.status(500).json({ msg: "Unable to change password" });
  }
});

module.exports = router;