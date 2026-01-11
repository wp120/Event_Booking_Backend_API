const Booking = require("../models/booking.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");

module.exports.createBooking = async (req, res) => {
  try {
    const { eventId, noOfSeats, userId } = req.body;
    if (!eventId || !noOfSeats || !userId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (noOfSeats <= 0) {
      return res
        .status(400)
        .json({ message: "Seats can not be zero or negative" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    //below code is re-written to be concurrency-safe.

    const updatedEvent = await Event.findOneAndUpdate(
      {
        _id: eventId,
        availableSeats: { $gte: noOfSeats },
      },
      {
        $inc: { availableSeats: -noOfSeats },
      },
      { new: true }
    );

    if (!updatedEvent) {
      return res.status(400).json({
        message: "Not enough seats available",
      });
    }

    const booking = await Booking.create({ eventId, noOfSeats, userId });
    return res
      .status(201)
      .json({ message: "Booking created Successfully.", booking });
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
