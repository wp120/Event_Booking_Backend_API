const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createBooking,
  getMyBookings,
} = require("../controllers/bookingController");

const router = express.Router();

router.post("/", authMiddleware, createBooking);

router.get("/me", authMiddleware, getMyBookings);

module.exports = router;
