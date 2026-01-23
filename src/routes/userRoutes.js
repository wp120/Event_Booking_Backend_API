const express = require("express");
const {
  registerUser,
  loginUser,
  deleteUser,
} = require("../controllers/userController");

const router = express.Router();

router.post("/register", registerUser);

router.post("/login", loginUser);

router.delete("/:userId", deleteUser);

module.exports = router;
