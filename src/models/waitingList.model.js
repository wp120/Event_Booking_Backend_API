const mongoose = require("mongoose");

const waitingListSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  noOfSeats: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

const WaitingList = mongoose.model("WaitingList", waitingListSchema);

// Indexes for querying by user or event
waitingListSchema.index({ userId: 1 });
waitingListSchema.index({ eventId: 1 });
waitingListSchema.index({ createdAt: 1 });

module.exports = WaitingList;
