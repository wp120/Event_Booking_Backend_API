const express = require("express");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dotenv = require("dotenv");
dotenv.config();
const port = process.env.PORT;

const mongoose = require("mongoose");

const userRouter = require("./routes/userRoutes");
const eventRouter = require("./routes/eventRoutes");
const bookingRouter = require("./routes/bookingRoutes");
const waitingListRouter = require("./routes/waitingListRoutes");

app.use("/auth", userRouter);

app.use("/events", eventRouter);

app.use("/bookings", bookingRouter);

app.use("/waitingList", waitingListRouter);

mongoose
  .connect(process.env.MONGODB_CONNECTION_URL)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((err) => {
    console.log("Error connecting to MongoDB: ", err);
  });
