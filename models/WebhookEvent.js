const mongoose = require("mongoose");

const WebhookEventSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  processedAt: { type: Date, default: Date.now }
});

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model("WebhookEvent", WebhookEventSchema);
