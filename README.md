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
- Cancel bookings safely under concurrent load
- Reject bookings when seats are unavailable or when cancellation is invalid
- Minimal authentication middleware
- Concurrency test script

---

## Project Structure

src/ \
├── index.js \
├── routes/ \
│ &nbsp;&nbsp; ├── userRoutes.js \
│ &nbsp;&nbsp; ├── eventRoutes.js \
│ &nbsp;&nbsp; └── bookingRoutes.js \
├── controllers/ \
│ &nbsp;&nbsp; ├── userController.js \
│ &nbsp;&nbsp; ├── eventController.js \
│ &nbsp;&nbsp; └── bookingController.js \
├── models/ \
│ &nbsp;&nbsp; ├── user.model.js \
│ &nbsp;&nbsp; ├── event.model.js \
│ &nbsp;&nbsp; ├── booking.model.js \
│ &nbsp;&nbsp; └── waitingList.model.js \
└── middlewares/ \
   └── authMiddleware.js \

tests/ \
└── concurrency.test.js \

---

## Running Locally

1. Install dependencies  
   `npm install`

2. Create `.env`  
   `MONGO_URI=your_mongodb_connection_string`  
   `PORT=3000`

3. Start server  
   `npm run dev`

---

## Authentication

Authentication is intentionally minimal.

Each request must include the header:

`x-user-id: <userId>`

The middleware injects `userId` into the request body.

---

## Concurrency Testing

A test script sends multiple concurrent booking requests to the same event
to verify that:

- Seats are never oversold
- Only valid bookings are created
- Database state remains consistent

---

## Booking Cancellation & Waiting List Promotion (Concurrency Design)

### High-level flow

- A user cancels a booking via `POST /api/bookings/cancel` with `x-user-id` set.
- The backend starts a **MongoDB transaction** and:
  - Atomically **restores seats** to the event using `$inc` guarded by the event id.
  - Deletes the booking document.
  - Tries to **promote waiting-list entries** into real bookings within the same transaction.

### How we avoid race conditions

- **Atomic seat updates**  
  - Both booking creation and cancellation use `findOneAndUpdate` with `$inc` and conditions like
    `availableSeats: { $gte: noOfSeats }` to ensure seats are never over- or under-counted,
    even when multiple requests run at the same time.

- **Claim-based waiting-list promotion**  
  - Each cancellation request generates a unique `cancellationId`.
  - Waiting-list entries are claimed one-by-one using `findOneAndUpdate` with:
    - `status: "pending"`
    - A filter on `processingBy` so the same cancellation does not re-claim an entry it already tried.
  - If there are not enough seats for a waiting-list entry:
    - Its `status` is set back to `"pending"`,
    - `processingBy` is set to the current `cancellationId`,
    - and the loop continues to the next eligible entry.
  - This allows **other concurrent cancellations** (with different `cancellationId`s) to still promote that entry if they free enough seats.

- **Unique index to prevent double-promotion**
  - Promoted bookings store `waitingListId` referencing the original waiting-list document.
  - A **unique sparse index** on `waitingListId` ensures that the same waiting-list entry
    cannot be turned into a real booking more than once, even if two transactions race.

Together, these patterns demonstrate a realistic, production-style approach to handling
concurrent cancellation and waiting list promotion without overselling seats or creating
duplicate bookings.
