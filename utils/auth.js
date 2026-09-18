const crypto = require("crypto");
const User = require("../models/user");
const { isFallback, readUsers } = require("./localStore");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.ADMIN_API_TOKEN;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_TOKEN_SECRET must be at least 32 characters");
  }
  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function createAuthToken(user) {
  const payload = encode({
    sub: String(user._id || user.id),
    email: String(user.email).toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  });
  return `${payload}.${sign(payload)}`;
}

function verifyAuthToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!user.email || !user.sub || Number(user.exp) <= Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch (error) {
    return null;
  }
}

async function requireUser(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const user = verifyAuthToken(token);
  if (!user) return res.status(401).json({ msg: "Authentication required" });
  try {
    const exists = isFallback(req)
      ? readUsers().some((item) => String(item.id) === user.sub && String(item.email).toLowerCase() === user.email)
      : Boolean(await User.exists({ _id: user.sub, email: user.email }));
    if (!exists) return res.status(401).json({ msg: "Your account no longer exists. Create a new account to continue." });
  } catch (error) {
    return res.status(503).json({ msg: "Unable to verify your account" });
  }
  req.user = user;
  next();
}

module.exports = { createAuthToken, requireUser, verifyAuthToken };
