# Event Booking Backend API

A backend service for booking limited-capacity events, built to demonstrate
real-world backend engineering concepts such as concurrency handling,
atomic database updates, and correctness under race conditions.

This project intentionally goes beyond basic CRUD operations and focuses on
preventing double booking under concurrent requests.

---

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- Axios (for concurrency testing)
- Nodemon (development)

---

## Core Engineering Problem

### Double Booking Under Concurrent Requests

When multiple users attempt to book seats for the same event simultaneously,
naive implementations can oversell seats.

This project prevents that using:

- Atomic conditional updates with MongoDB
- Database-level guarantees
- Concurrency simulation using parallel HTTP requests

---

## Key Concepts Demonstrated

- Atomic operations in MongoDB
- Race conditions and concurrent requests
- Safe inventory decrement pattern
- Validation vs business logic separation
- Middleware usage
- Clean backend project structure

---

## Features

- Create users
- Create events with limited seats
- Book events safely under concurrent load
- Reject bookings when seats are unavailable
- Minimal authentication middleware
- Concurrency test script

---

## Project Structure

src/
├── index.js
├── routes/
│ ├── userRoutes.js
│ ├── eventRoutes.js
│ └── bookingRoutes.js
├── controllers/
│ ├── userController.js
│ ├── eventController.js
│ └── bookingController.js
├── models/
│ ├── User.js
│ ├── Event.js
│ └── Booking.js
└── middlewares/
└── authMiddleware.js

tests/
└── concurrency.test.js

---

## Authentication

Authentication is intentionally minimal.

Each request must include the header:

x-user-id: <userId>

The middleware injects `userId` into the request body.

---

## Concurrency Testing

A test script sends multiple concurrent booking requests to the same event
to verify that:

- Seats are never oversold
- Only valid bookings are created
- Database state remains consistent

---

## Running Locally

1. Install dependencies
   `npm install`

2. Create `.env`
   MONGO_URI=your_mongodb_connection_string
   PORT=3000

3. Start server
   `npm run dev`
