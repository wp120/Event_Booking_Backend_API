const express = require("express");
const {
  createEvent,
  getEvents,
  getEventAnalytics,
  deleteEvent,
} = require("../controllers/eventController");

const router = express.Router();

router.post("/", createEvent);

router.get("/", getEvents);

router.get("/:eventId/analytics", getEventAnalytics);

router.delete("/:eventId", deleteEvent);

module.exports = router;
