const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { MongoMemoryServer } = require("mongodb-memory-server");
const { resolveMongoUri } = require("./utils/mongoEnv");

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_DATA_DIR = path.join(__dirname, ".mongo-data", String(process.pid));

function resolveMongoMemorySystemBinary() {
  const directPath = process.env.MONGOMS_SYSTEM_BINARY || process.env.SYSTEM_BINARY;

  if (directPath && fs.existsSync(directPath)) {
    return directPath;
  }

  const candidatePath = path.join(process.env.HOME || "", ".cache", "mongodb-binaries", "mongod-x64-unknown-8.2.6");

  if (fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  return null;
}

// ===== MIDDLEWARE =====
app.use(cors({
  origin: "*"
}));
app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

// ===== DATABASE =====
async function startDatabase() {
  const configuredUri = resolveMongoUri(process.env);

  if (configuredUri) {
    try {
      await mongoose.connect(configuredUri);
      console.log("MongoDB connected to configured URI");
      return true;
    } catch (err) {
      console.warn("Configured MongoDB URI failed. Using file-backed storage.", err.message);
      return false;
    }
  } else {
    console.log("No MONGODB_URI configured. Using in-memory MongoDB for this deployment.");
  }

  try {
    const systemBinary = resolveMongoMemorySystemBinary();
    fs.mkdirSync(MONGO_DATA_DIR, { recursive: true });

    const memoryServer = await MongoMemoryServer.create(
      systemBinary
        ? {
            binary: {
              systemBinary,
              version: "8.2.6"
            },
            instance: {
              dbPath: MONGO_DATA_DIR,
              storageEngine: "wiredTiger"
            }
          }
        : {
            instance: {
              dbPath: MONGO_DATA_DIR,
              storageEngine: "wiredTiger"
            }
          }
    );

    const memoryUri = memoryServer.getUri();
    await mongoose.connect(memoryUri);
    console.log("MongoDB connected to in-memory server");
    return true;
  } catch (err) {
    console.warn("MongoDB startup failed. Falling back to file-backed storage mode.", err.message);
    return false;
  }
}

// ===== ROUTES =====
app.use("/api/auth", require("./routes/auth"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/resellerxpress", require("./routes/resellerxpress"));
app.use("/api/remadata", require("./routes/remadata"));
app.use("/api/sendcomms", require("./routes/sendcomms"));
app.use("/api/support", require("./routes/support"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/payments", require("./routes/payments"));

// ===== TEST ROUTE =====
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    mode: app.locals.dbReady ? "mongodb" : "file-fallback",
    message: "WIMPS API running"
  });
});

// ===== SERVER =====
async function startServer() {
  app.locals.dbReady = false;
  try {
    app.locals.dbReady = await startDatabase();
  } catch (err) {
    app.locals.dbReady = false;
    console.error("Database startup failed; continuing with file-backed storage:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();