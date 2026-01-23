const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createBooking,
  getMyBookings,
  getBookings,
  cancelBooking,
} = require("../controllers/bookingController");

const router = express.Router();

// Create a new booking
router.post("/", authMiddleware, createBooking);

// Get bookings for the authenticated user
router.get("/me", authMiddleware, getMyBookings);

// Get bookings with optional filters (eventId, userId, or both via query params)
// GET /bookings?eventId=...&userId=...
router.get("/", getBookings);

// Cancel a booking for the authenticated user
router.post("/cancel", authMiddleware, cancelBooking);

module.exports = router;
