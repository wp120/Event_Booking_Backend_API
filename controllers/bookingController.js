const Booking = require("../models/booking.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");

module.exports.createBooking = async (req, res) => {
  try {
    const { eventId, noOfSeats, userId } = req.body;
    if (!eventId || !noOfSeats || !userId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (event.availableSeats < noOfSeats) {
      return res.status(400).json({ message: "Not enough seats available" });
    }
    if (new Date(event.startTime) < new Date()) {
      return res.status(400).json({ message: "Event has already started" });
    }
    event.availableSeats -= noOfSeats;
    await event.save();

    const booking = await Booking.create({ eventId, noOfSeats, userId });
    return res.status(201).json({ booking });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error booking event", error: err.message });
  }
};

module.exports.getMyBookings = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const bookings = await Booking.find({ userId });
    return res.status(200).json({ bookings });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching bookings", error: err.message });
  }
};
