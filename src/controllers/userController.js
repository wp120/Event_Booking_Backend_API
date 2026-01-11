const User = require("../models/user.model");

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
