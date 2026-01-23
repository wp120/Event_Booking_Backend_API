const express = require("express");
const {
  createEvent,
  getEvents,
  deleteEvent,
} = require("../controllers/eventController");

const router = express.Router();

router.post("/", createEvent);

router.get("/", getEvents);

router.delete("/:eventId", deleteEvent);

module.exports = router;
