const express = require("express");
const { getWaitingList } = require("../controllers/waitingListController");

const router = express.Router();

router.get("/", getWaitingList);

module.exports = router;
