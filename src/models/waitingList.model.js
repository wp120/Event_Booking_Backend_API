const mongoose = require("mongoose");

const waitingListSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  noOfSeats: { type: Number, required: true },
  idempotencyKey: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "processing"],
    default: "pending",
    required: true,
  },
  processingAt: { type: Date, default: null },
  processingBy: {
    type: String,
    default: null,
  },
  createdAt: { type: Date, default: Date.now },
});

const WaitingList = mongoose.model("WaitingList", waitingListSchema);

// Indexes for querying by user or event
waitingListSchema.index({ userId: 1 });
waitingListSchema.index({ eventId: 1 });
waitingListSchema.index({ createdAt: 1 });
waitingListSchema.index({ eventId: 1, status: 1, createdAt: 1 });
// Idempotency: unique combination of (idempotencyKey, userId, eventId)
waitingListSchema.index({ idempotencyKey: 1, userId: 1, eventId: 1 }, { unique: true });

module.exports = WaitingList;
