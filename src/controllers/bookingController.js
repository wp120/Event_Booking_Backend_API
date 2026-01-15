const Booking = require("../models/booking.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const WaitingList = require("../models/waitingList.model");
const ApiError = require("../errors/ApiError");
const mongoose = require("mongoose");

module.exports.createBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { eventId, noOfSeats, userId } = req.body;
    if (!eventId || !noOfSeats || !userId) {
      throw new ApiError(400, "All fields are required");
    }

    if (noOfSeats <= 0) {
      throw new ApiError(400, "Seats can not be zero or negative");
    }

    const userExists = await User.exists({ _id: userId }).session(session);
    if (!userExists) {
      throw new ApiError(404, "User not found");
    }

    const eventExists = await Event.exists({ _id: eventId }).session(session);
    if (!eventExists) {
      throw new ApiError(404, "Event not found");
    }

    const updatedEvent = await Event.findOneAndUpdate(
      {
        _id: eventId,
        availableSeats: { $gte: noOfSeats },
      },
      {
        $inc: { availableSeats: -noOfSeats },
      },
      {
        new: true,
        session,
      }
    );

    if (!updatedEvent) {
      const waitingList = await WaitingList.create(
        [{ eventId, noOfSeats, userId }],
        { session }
      );

      await session.commitTransaction();

      return res.status(202).json({
        message: "Enough seats not available. Added to waiting list.",
        waitingList: waitingList[0],
      });
    }

    const booking = await Booking.create([{ eventId, noOfSeats, userId }], {
      session,
    });

    await session.commitTransaction();

    return res
      .status(201)
      .json({ message: "Booking created Successfully.", booking: booking[0] });
  } catch (err) {
    await session.abortTransaction();

    return res.status(err.statusCode || 500).json({
      message: err.message || "Internal Server Error",
    });
  } finally {
    session.endSession();
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
