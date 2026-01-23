const Event = require("../models/event.model");
const Booking = require("../models/booking.model");
const WaitingList = require("../models/waitingList.model");
const ApiError = require("../errors/ApiError");
const mongoose = require("mongoose");

module.exports.createEvent = async (req, res) => {
  try {
    const { title, totalSeats, availableSeats, startTime } = req.body;
    if (!title || !totalSeats || !availableSeats || !startTime) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (totalSeats < availableSeats) {
      return res
        .status(400)
        .json({ message: "Total seats cannot be less than available seats" });
    }
    if (new Date(startTime) < new Date()) {
      return res
        .status(400)
        .json({ message: "Start time cannot be in the past" });
    }
    const event = await Event.create({
      title,
      totalSeats,
      availableSeats,
      startTime: new Date(startTime),
    });
    return res.status(201).json({ event });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error creating event", error: err.message });
  }
};

module.exports.getEvents = async (req, res) => {
  try {
    const events = await Event.find();
    return res.status(200).json({ events });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching events", error: err.message });
  }
};

module.exports.getEventAnalytics = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    if (!eventId) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const analytics = {
      eventCapacity: event.totalSeats,
      availableSeats: event.availableSeats,
      totalBookings: event.totalBookings || 0,
      totalCancelled: event.totalCancelled || 0,
      totalWaitlisted: event.totalWaitlisted || 0,
    };

    return res.status(200).json({ analytics });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching event analytics", error: err.message });
  }
};

module.exports.deleteEvent = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { eventId } = req.params;
    if (!eventId) {
      throw new ApiError(400, "Event ID is required");
    }

    // Check if event exists
    const event = await Event.findById(eventId).session(session);
    if (!event) {
      throw new ApiError(404, "Event not found");
    }

    // Delete all bookings for this event
    await Booking.deleteMany({ eventId }).session(session);

    // Delete all waiting list entries for this event
    await WaitingList.deleteMany({ eventId }).session(session);

    // Delete the event itself
    await Event.deleteOne({ _id: eventId }).session(session);

    await session.commitTransaction();

    return res.status(200).json({
      message: "Event deleted successfully along with all related bookings and waiting list entries",
    });
  } catch (error) {
    await session.abortTransaction();

    return res.status(error.statusCode || 500).json({
      message: error.message || "Internal Server Error",
    });
  } finally {
    session.endSession();
  }
};
