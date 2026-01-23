const User = require("../models/user.model");
const Booking = require("../models/booking.model");
const WaitingList = require("../models/waitingList.model");
const ApiError = require("../errors/ApiError");
const mongoose = require("mongoose");

module.exports.registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const user = await User.create({ name, email, password });
    return res.status(201).json({ user });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error registering user", error: err.message });
  }
};

module.exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    return res.status(200).json({ message: "Login successful", user });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error logging in", error: err.message });
  }
};

module.exports.deleteUser = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { userId } = req.params;
    if (!userId) {
      throw new ApiError(400, "User ID is required");
    }

    // Check if user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Delete all bookings for this user
    await Booking.deleteMany({ userId }).session(session);

    // Delete all waiting list entries for this user
    await WaitingList.deleteMany({ userId }).session(session);

    // Delete the user itself
    await User.deleteOne({ _id: userId }).session(session);

    await session.commitTransaction();

    return res.status(200).json({
      message: "User deleted successfully along with all related bookings and waiting list entries",
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
