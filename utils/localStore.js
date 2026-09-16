const crypto = require("crypto");
const { readData, writeData } = require("./fileDb");

function isFallback(req) {
  return req.app.locals.dbReady === false;
}

function readUsers() {
  return readData("users.json") || [];
}

function writeUsers(users) {
  writeData("users.json", users);
}

function readTransactions() {
  return readData("transactions.json") || [];
}

function writeTransactions(transactions) {
  writeData("transactions.json", transactions);
}

function createId() {
  return crypto.randomUUID();
}

module.exports = {
  createId,
  isFallback,
  readUsers,
  writeUsers,
  readTransactions,
  writeTransactions
};
