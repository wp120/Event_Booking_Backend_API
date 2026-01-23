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
- MongoDB transactions for multi-document operations
- Retry logic with exponential backoff
- Idempotency patterns for safe retries
- Soft deletes with status tracking
- Claim-based processing for waiting lists
- Unique indexes for data integrity
- Validation vs business logic separation
- Middleware usage
- Clean backend project structure

---

## Features

- Create users
- Create events with limited seats
- Book events safely under concurrent load
- Cancel bookings safely under concurrent load (soft delete with status update)
- Automatic waiting list promotion when seats become available
- Idempotency key support to prevent duplicate bookings from retries
- Booking status tracking (active/cancelled)
- Event analytics (total bookings, cancellations, waitlisted)
- Reject bookings when seats are unavailable or when cancellation is invalid
- Minimal authentication middleware
- Comprehensive concurrency and idempotency test scripts

---

## Project Structure

src/ \
├── index.js \
├── routes/ \
│ &nbsp;&nbsp; ├── userRoutes.js \
│ &nbsp;&nbsp; ├── eventRoutes.js \
│ &nbsp;&nbsp; ├── bookingRoutes.js \
│ &nbsp;&nbsp; └── waitingListRoutes.js \
├── controllers/ \
│ &nbsp;&nbsp; ├── userController.js \
│ &nbsp;&nbsp; ├── eventController.js \
│ &nbsp;&nbsp; ├── bookingController.js \
│ &nbsp;&nbsp; └── waitingListController.js \
├── models/ \
│ &nbsp;&nbsp; ├── user.model.js \
│ &nbsp;&nbsp; ├── event.model.js \
│ &nbsp;&nbsp; ├── booking.model.js \
│ &nbsp;&nbsp; └── waitingList.model.js \
├── middlewares/ \
│ &nbsp;&nbsp; └── authMiddleware.js \
└── errors/ \
   └── ApiError.js \

tests/ \
├── bookingConcurrency.test.js \
├── cancelConcurrency.test.js \
├── waitingListPromotionConcurrency.test.js \
└── idempotency.test.js \

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

## Idempotency

To prevent duplicate bookings from network retries or user double-clicks, all booking requests require an idempotency key.

### Required Header

`x-idempotency-key: <UUID v4>`

The idempotency key must be a valid UUID v4 format. The combination of `(idempotencyKey, userId, eventId)` must be unique.

### Behavior

- **First request** with a unique idempotency key: Creates a new booking or waiting list entry (status 201 or 202)
- **Subsequent requests** with the same idempotency key: Returns the existing booking/waiting list entry (status 200)
- **Missing idempotency key**: Returns 400 error
- **Invalid UUID format**: Returns 400 error

This ensures that if a client retries a request (due to network issues, timeouts, etc.), the same booking is not created multiple times.

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
  - Updates the booking status to `"cancelled"` (soft delete).
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

---

## Booking Status

Bookings have a `status` field that can be:
- `"active"`: The booking is valid and active
- `"cancelled"`: The booking has been cancelled (soft delete)

When a booking is cancelled, its status is updated to `"cancelled"` instead of deleting the document. This allows for:
- Historical tracking of bookings
- Analytics on cancellations
- Audit trails

### Querying by Status

The `GET /api/bookings` and `GET /api/bookings/me` endpoints support a `status` query parameter:
- `?status=active` - Returns only active bookings (default)
- `?status=cancelled` - Returns only cancelled bookings
- `?status=all` - Returns all bookings regardless of status

---

## Event Analytics

Events track the following metrics:
- `totalBookings`: Total number of bookings created (including cancelled ones)
- `totalCancelled`: Total number of bookings that were cancelled
- `totalWaitlisted`: Total number of users added to the waiting list

These metrics are updated atomically during booking creation and cancellation.

### Get Analytics

`GET /api/events/:eventId/analytics`

Returns:
- Event capacity information
- Current available seats
- Total bookings, cancellations, and waitlisted counts

---

## Retry Logic

The booking and cancellation controllers implement retry logic with exponential backoff to handle MongoDB write conflicts and transaction aborts. This ensures that transient database conflicts don't cause request failures.

---

## Testing

The project includes comprehensive test scripts for validating concurrency safety:

- **`npm run test:booking`** - Tests concurrent booking creation
- **`npm run test:cancel`** - Tests concurrent booking cancellation
- **`npm run test:waitlist`** - Tests concurrent waiting list promotion
- **`npm run test:idempotency`** - Tests idempotency key functionality
- **`npm run test:all`** - Runs all tests sequentially

All tests:
- Dynamically create test data (users, events)
- Run concurrent requests to simulate race conditions
- Verify correctness and data consistency
- Clean up test data after completion
- Provide clear PASS/FAIL results
