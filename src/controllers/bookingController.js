const Booking = require("../models/booking.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const WaitingList = require("../models/waitingList.model");
const ApiError = require("../errors/ApiError");
const mongoose = require("mongoose");

// Helper function to check if error is a write conflict
const isWriteConflictError = (error) => {
  return (
    error?.code === 112 ||
    error?.message?.includes("WriteConflict") ||
    error?.message?.includes("Write conflict")
  );
};

// Helper function to validate UUID v4 format
const isValidUUIDv4 = (uuid) => {
  const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidv4Regex.test(uuid);
};

// Helper function for retry logic with exponential backoff
const retryWithBackoff = async (operation, maxRetries = 3, baseDelay = 50) => {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Only retry on write conflict errors or transaction abort errors
      const isRetryableError = 
        isWriteConflictError(error) || 
        error?.message?.includes("Transaction") && error?.message?.includes("aborted");
      
      if (!isRetryableError || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: 50ms, 100ms, 200ms
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

module.exports.createBooking = async (req, res) => {
  const { eventId, noOfSeats, userId } = req.body;
  
  // Extract and validate idempotencyKey from headers
  const idempotencyKey = req.headers["x-idempotency-key"];
  
  if (!idempotencyKey) {
    return res.status(400).json({ message: "idempotencyKey is required in headers" });
  }

  if (!isValidUUIDv4(idempotencyKey)) {
    return res.status(400).json({ message: "Invalid idempotencyKey format. Expected UUID v4" });
  }
  
  // Validation (outside transaction)
  if (!eventId || !noOfSeats || !userId) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (noOfSeats <= 0) {
    return res.status(400).json({ message: "Seats can not be zero or negative" });
  }

  // Retry entire transaction on write conflicts
  try {
    const result = await retryWithBackoff(async () => {
      const session = await mongoose.startSession();
      
      try {
        session.startTransaction();

        const userExists = await User.exists({ _id: userId }).session(session);
        if (!userExists) {
          throw new ApiError(404, "User not found");
        }

        const eventExists = await Event.exists({ _id: eventId }).session(session);
        if (!eventExists) {
          throw new ApiError(404, "Event not found");
        }

        // Check for existing booking with same idempotencyKey, userId, eventId
        const existingBooking = await Booking.findOne({
          idempotencyKey,
          userId,
          eventId,
        }).session(session);

        if (existingBooking) {
          await session.commitTransaction();
          await session.endSession();
          return { status: 200, data: { message: "Booking already exists (idempotent request).", booking: existingBooking } };
        }

        // Check for existing waiting list entry with same idempotencyKey, userId, eventId
        const existingWaitingList = await WaitingList.findOne({
          idempotencyKey,
          userId,
          eventId,
        }).session(session);

        if (existingWaitingList) {
          await session.commitTransaction();
          await session.endSession();
          return { status: 200, data: { message: "Waiting list entry already exists (idempotent request).", waitingList: existingWaitingList } };
        }

        const updatedEvent = await Event.findOneAndUpdate(
          {
            _id: eventId,
            availableSeats: { $gte: noOfSeats },
          },
          {
            $inc: { availableSeats: -noOfSeats, totalBookings: 1 },
          },
          {
            new: true,
            session,
          }
        );

        if (!updatedEvent) {
          // Increment totalWaitlisted when adding to waiting list
          await Event.findOneAndUpdate(
            { _id: eventId },
            { $inc: { totalWaitlisted: 1 } },
            { session }
          );

          try {
            const waitingList = await WaitingList.create(
              [{ eventId, noOfSeats, userId, idempotencyKey }],
              { session }
            );

            await session.commitTransaction();
            await session.endSession();

            return { status: 202, data: { message: "Enough seats not available. Added to waiting list.", waitingList: waitingList[0] } };
          } catch (createError) {
            // Handle duplicate key error (race condition)
            if (createError && createError.code === 11000) {
              await session.abortTransaction();
              await session.endSession();
              
              // Query and return existing waiting list entry
              const existingWaitList = await WaitingList.findOne({
                idempotencyKey,
                userId,
                eventId,
              });
              
              if (existingWaitList) {
                return { status: 200, data: { message: "Waiting list entry already exists (idempotent request).", waitingList: existingWaitList } };
              }
            }
            throw createError;
          }
        }

        try {
          const booking = await Booking.create([{ eventId, noOfSeats, userId, idempotencyKey }], {
            session,
          });

          await session.commitTransaction();
          await session.endSession();

          return { status: 201, data: { message: "Booking created Successfully.", booking: booking[0] } };
        } catch (createError) {
          // Handle duplicate key error (race condition)
          if (createError && createError.code === 11000) {
            await session.abortTransaction();
            await session.endSession();
            
            // Query and return existing booking
            const existingBook = await Booking.findOne({
              idempotencyKey,
              userId,
              eventId,
            });
            
            if (existingBook) {
              return { status: 200, data: { message: "Booking already exists (idempotent request).", booking: existingBook } };
            }
          }
          throw createError;
        }
      } catch (error) {
        await session.abortTransaction();
        await session.endSession();
        throw error;
      }
    });

    return res.status(result.status).json(result.data);
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || "Internal Server Error",
    });
  }
};

module.exports.cancelBooking = async (req, res) => {
  const bookingId = req.body.bookingId;
  const userId = req.body.userId;

  // Validation (outside transaction)
  if(!bookingId || !userId){
    return res.status(400).json({ message: "Booking Id and User Id are required." });
  }

  // Retry entire transaction on write conflicts
  try {
    await retryWithBackoff(async () => {
      const session = await mongoose.startSession();
      const cancellationId = new mongoose.Types.ObjectId().toString();

      try {
        session.startTransaction();

        // 1. Fetch booking (only active bookings can be cancelled)
        const booking = await Booking.findOne({
          _id: bookingId,
          userId,
          status: "active",
        }).session(session);

        if (!booking) {
          throw new ApiError(404, "Booking not found or already cancelled.");
        }

        // 2. Restore seats atomically on the event and increment totalCancelled
        const updatedEvent = await Event.findOneAndUpdate(
          { _id: booking.eventId },
          { $inc: { availableSeats: booking.noOfSeats, totalCancelled: 1 } },
          { new: true, session }
        );

        if (!updatedEvent) {
          throw new ApiError(404, "Event not found.");
        }

        // 3. Update booking status to cancelled
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { status: "cancelled" } }
        ).session(session);

        // 4. Promote waiting-list bookings (skip if it does not fit) using claim-based processing
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

          // Try to atomically allocate seats for this waiting-list entry and increment totalBookings
          const promotedEvent = await Event.findOneAndUpdate(
            {
              _id: wait.eventId,
              availableSeats: { $gte: wait.noOfSeats },
            },
            {
              $inc: { availableSeats: -wait.noOfSeats, totalBookings: 1, totalWaitlisted: -1 },
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
                  idempotencyKey: wait.idempotencyKey,
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
        await session.endSession();
      } catch (error) {
        await session.abortTransaction();
        await session.endSession();
        throw error;
      }
    });

    return res.status(200).json({
      message: "Booking cancelled and waiting list promoted",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getMyBookings = async (req, res) => {
  try {
    const { userId } = req.body;
    const { status } = req.query;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const filter = { userId };
    
    // Handle status filtering
    if (status) {
      if (status !== "active" && status !== "cancelled" && status !== "all") {
        return res.status(400).json({ message: "Invalid status. Must be 'active', 'cancelled', or 'all'" });
      }
      if (status !== "all") {
        filter.status = status;
      }
      // If status === "all", don't add status filter (show all)
    } else {
      // Default behavior: show only active bookings if no status param
      filter.status = "active";
    }
    
    const bookings = await Booking.find(filter);
    return res.status(200).json({ bookings });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching bookings", error: err.message });
  }
};

module.exports.getBookings = async (req, res) => {
  try {
    const { eventId, userId, status } = req.query;
    const filter = {};

    // Build filter based on query parameters
    if (eventId) {
      // Validate event exists
      const eventExists = await Event.exists({ _id: eventId });
      if (!eventExists) {
        return res.status(404).json({ message: "Event not found" });
      }
      filter.eventId = eventId;
    }

    if (userId) {
      // Validate user exists
      const userExists = await User.exists({ _id: userId });
      if (!userExists) {
        return res.status(404).json({ message: "User not found" });
      }
      filter.userId = userId;
    }

    // Handle status filtering
    if (status) {
      if (status !== "active" && status !== "cancelled" && status !== "all") {
        return res.status(400).json({ message: "Invalid status. Must be 'active', 'cancelled', or 'all'" });
      }
      if (status !== "all") {
        filter.status = status;
      }
      // If status === "all", don't add status filter (show all)
    } else {
      // Default behavior: show only active bookings if no status param
      filter.status = "active";
    }

    // If no filters provided, return all bookings
    // Otherwise, return filtered bookings
    const bookings = await Booking.find(filter);
    return res.status(200).json({ bookings });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching bookings", error: err.message });
  }
};
