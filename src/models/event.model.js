const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  totalSeats: { type: Number, required: true },
  availableSeats: { type: Number, required: true },
  startTime: { type: Date, required: true },
  totalBookings: { type: Number, default: 0 },
  totalCancelled: { type: Number, default: 0 },
  totalWaitlisted: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const Event = mongoose.model("Event", eventSchema);

// Index for listing upcoming events
eventSchema.index({ startTime: 1 });

module.exports = Event;
