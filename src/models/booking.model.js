const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
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
    enum: ["active", "cancelled"],
    default: "active",
    required: true,
  },
  // Present only for bookings promoted from waiting list
  waitingListId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "WaitingList",
    // default: null,
  },
  createdAt: { type: Date, default: Date.now },
});

const Booking = mongoose.model("Booking", bookingSchema);

// Indexes for querying by user or event
bookingSchema.index({ userId: 1 });
bookingSchema.index({ eventId: 1 });
// Prevent duplicate promotions of the same waiting-list entry
bookingSchema.index({ waitingListId: 1 }, { unique: true, sparse: true });
// Idempotency: unique combination of (idempotencyKey, userId, eventId)
bookingSchema.index({ idempotencyKey: 1, userId: 1, eventId: 1 }, { unique: true });
// Status indexes for efficient filtering
bookingSchema.index({ status: 1 });
bookingSchema.index({ eventId: 1, status: 1 });
bookingSchema.index({ userId: 1, status: 1 });

module.exports = Booking;
