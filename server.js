const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_DATA_DIR = path.join(__dirname, ".mongo-data");

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
app.use(express.json());

// ===== DATABASE =====
async function startDatabase() {
  const configuredUri = process.env.MONGODB_URI;

  if (configuredUri) {
    try {
      await mongoose.connect(configuredUri);
      app.locals.dbReady = true;
      console.log("MongoDB connected to configured URI");
      return;
    } catch (err) {
      console.warn("Configured MongoDB URI failed. Falling back to in-memory MongoDB.", err.message);
    }
  } else {
    console.log("No MONGODB_URI configured. Using in-memory MongoDB for this deployment.");
  }

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
  app.locals.dbReady = false;
  console.log("MongoDB connected to in-memory server");
}

// ===== ROUTES =====
app.use("/api/auth", require("./routes/auth"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/resellerxpress", require("./routes/resellerxpress"));
app.use("/api/remadata", require("./routes/remadata"));
app.use("/api/sendcomms", require("./routes/sendcomms"));
app.use("/api/admin", require("./routes/admin"));

// ===== TEST ROUTE =====
app.get("/", (req, res) => {
  res.send("API running...");
});

// ===== SERVER =====
async function startServer() {
  try {
    await startDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();