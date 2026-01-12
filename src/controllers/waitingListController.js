const WaitingList = require("../models/waitingList.model");
const User = require("../models/user.model");

module.exports.getWaitingList = async (req, res) => {
  try {
    const { userId } = req.body || {};

    let filter = {};
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ message: "User not found for given userId" });
      }
      filter = { userId: userId };
    }
    const waitingList = await WaitingList.find(filter);
    return res.status(200).json({ waitingList });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error fetching waitingList", error: err.message });
  }
};
