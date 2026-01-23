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

module.exports.cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const cancellationId = new mongoose.Types.ObjectId().toString();

    const bookingId = req.body.bookingId;
    const userId = req.body.userId;

    if(!bookingId || !userId){
      throw new ApiError(400,"Booking Id and User Id are required.");
    }

    // 1. Fetch booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
    }).session(session);

    if (!booking) {
      throw new ApiError(404,"Booking not found.");
    }

    // 2. Restore seats atomically on the event
    const updatedEvent = await Event.findOneAndUpdate(
      { _id: booking.eventId },
      { $inc: { availableSeats: booking.noOfSeats } },
      { new: true, session }
    );

    if (!updatedEvent) {
      throw new ApiError(404, "Event not found.");
    }

    // 4. Delete booking
    await Booking.deleteOne({ _id: booking._id }).session(session);

    // 5. Promote waiting-list bookings (skip if it does not fit) using claim-based processing
    while (true) {
      const wait = await WaitingList.findOneAndUpdate(
        {
          eventId: updatedEvent._id,
          status: "pending",
          $or: [
            { processingBy: null },
            { processingBy: { $ne: cancellationId } },
          ],
          // Optional: reclaim stuck items (keep commented for now)
          // $or: [
          //   { status: "pending" },
          //   { status: "processing", processingAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
          // ],
        },
        {
          $set: {
            status: "processing",
            processingAt: new Date(),
            processingBy: cancellationId,
          },
        },
        {
          sort: { createdAt: 1 },
          new: true,
          session,
        }
      );

      if (!wait) break;

      // Try to atomically allocate seats for this waiting-list entry
      const promotedEvent = await Event.findOneAndUpdate(
        {
          _id: wait.eventId,
          availableSeats: { $gte: wait.noOfSeats },
        },
        {
          $inc: { availableSeats: -wait.noOfSeats },
        },
        {
          new: true,
          session,
        }
      );

      // Skip if not enough seats are available at this moment:
      // release claim back to pending and continue.
      if (!promotedEvent) {
        await WaitingList.updateOne(
          { _id: wait._id },
          {
            $set: {
              status: "pending",
              processingAt: null,
              processingBy: cancellationId,
            },
          }
        ).session(session);
        continue;
      }

      // move waiting → booking (with unique guardrail)
      try {
        await Booking.create(
          [
            {
              userId: wait.userId,
              eventId: wait.eventId,
              noOfSeats: wait.noOfSeats,
              waitingListId: wait._id,
            },
          ],
          { session }
        );
      } catch (e) {
        // If another concurrent flow already promoted this waiting-list entry,
        // the unique index on waitingListId will reject the duplicate. In that case,
        // just clean up the waiting-list entry and keep going.
        if (e && e.code === 11000) {
          await WaitingList.deleteOne({ _id: wait._id }).session(session);
          continue;
        }
        throw e;
      }

      await WaitingList.deleteOne({ _id: wait._id }).session(session);
    }

    await session.commitTransaction();

    res.status(200).json({
      message: "Booking cancelled and waiting list promoted",
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
