const Event = require("../models/event.model");

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
