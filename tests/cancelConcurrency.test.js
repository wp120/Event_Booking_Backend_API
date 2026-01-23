const axios = require("axios");

const BASE_URL = "http://localhost:3000";

const createUser = (index) => {
  return axios.post(`${BASE_URL}/auth/register`, {
    name: `User ${index}`,
    email: `user${index}@test.com`,
    password: "password123",
  });
};

const createEvent = () => {
  // Set startTime to tomorrow to avoid "start time cannot be in the past" validation error
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return axios.post(`${BASE_URL}/events`, {
    title: "Cancel Concurrency Test Event",
    totalSeats: 3,
    availableSeats: 3,
    startTime: tomorrow.toISOString(),
  });
};

const createBookingRequest = (eventId, userId) => {
  return axios.post(
    `${BASE_URL}/bookings`,
    {
      eventId,
      noOfSeats: 1,
    },
    {
      headers: {
        "x-user-id": userId,
      },
    }
  );
};

const cancelBookingRequest = (bookingId, userId) => {
  return axios.post(
    `${BASE_URL}/bookings/cancel`,
    { bookingId },
    {
      headers: {
        "x-user-id": userId,
      },
    }
  );
};

const getEvent = async (eventId) => {
  const res = await axios.get(`${BASE_URL}/events`);
  return res.data.events.find((e) => e._id === eventId);
};

const deleteUser = (userId) => {
  return axios.delete(`${BASE_URL}/auth/${userId}`);
};

const deleteEvent = (eventId) => {
  return axios.delete(`${BASE_URL}/events/${eventId}`);
};

const run = async () => {
  let userIds = [];
  let eventId = null;
  let bookingIds = [];
  let testPassed = true;

  try {
    // 1. Setup: Create users
    console.log("Setting up test data...");
    const userCount = 6;
    const userResults = await Promise.all(
      Array.from({ length: userCount }, (_, i) => createUser(i + 1))
    );
    userIds = userResults.map((r) => r.data.user._id);

    // 2. Setup: Create event with limited seats
    const eventRes = await createEvent();
    eventId = eventRes.data.event._id;

    // 3. Setup: Create bookings to fill the event
    // Create 3 bookings (1 seat each) to fully book the event
    const bookingResults = await Promise.all(
      userIds.slice(0, 3).map((userId) =>
        createBookingRequest(eventId, userId)
      )
    );
    bookingIds = bookingResults
      .filter((r) => r.status === 201)
      .map((r) => r.data.booking._id);

    if (bookingIds.length !== 3) {
      throw new Error(
        `Failed to create 3 bookings. Only created ${bookingIds.length}`
      );
    }

    // 4. Setup: Get initial event state
    const initialEvent = await getEvent(eventId);
    const initialAvailableSeats = initialEvent.availableSeats;
    // Should be 0 after 3 bookings of 1 seat each

    if (initialAvailableSeats !== 0) {
      throw new Error(
        `Expected 0 available seats after booking, got ${initialAvailableSeats}`
      );
    }

    console.log("Test data setup complete. Running concurrency tests...");

    // 5. TEST SCENARIO A: Concurrent cancellation of the SAME booking
    console.log("Scenario A: Testing concurrent cancellation of same booking...");
    const sameBookingId = bookingIds[0];
    const sameBookingOwnerId = userIds[0];

    const sameBookingCancelResults = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        cancelBookingRequest(sameBookingId, sameBookingOwnerId)
      )
    );

    const sameBookingSuccesses = sameBookingCancelResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200
    );
    const sameBookingNotFound = sameBookingCancelResults.filter(
      (r) =>
        r.status === "rejected" &&
        r.reason?.response?.status === 404
    );

    // Expectation: Only 1 cancellation should succeed, rest should be 404
    if (sameBookingSuccesses.length !== 1) {
      console.error(
        `FAILED (Scenario A): Expected exactly 1 successful cancellation, got ${sameBookingSuccesses.length}`
      );
      testPassed = false;
    } else {
      console.log("✓ Scenario A passed: Exactly 1 cancellation succeeded");
    }

    // 6. Verify seat restoration after Scenario A
    const afterScenarioAEvent = await getEvent(eventId);
    const afterScenarioAAvailableSeats = afterScenarioAEvent.availableSeats;

    // Should have restored 1 seat (from the cancelled booking)
    if (afterScenarioAAvailableSeats !== initialAvailableSeats + 1) {
      console.error(
        `FAILED (Seat restoration after Scenario A): Expected ${initialAvailableSeats + 1} available seats, got ${afterScenarioAAvailableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Seat restoration correct: ${afterScenarioAAvailableSeats} seats available`
      );
    }

    // 7. TEST SCENARIO B: Concurrent cancellation of DIFFERENT bookings
    console.log(
      "Scenario B: Testing concurrent cancellation of different bookings..."
    );
    // Cancel the remaining 2 bookings concurrently
    const differentBookingCancelResults = await Promise.allSettled([
      cancelBookingRequest(bookingIds[1], userIds[1]),
      cancelBookingRequest(bookingIds[2], userIds[2]),
    ]);

    const differentBookingSuccesses = differentBookingCancelResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200
    );

    // Expectation: Both cancellations should succeed
    if (differentBookingSuccesses.length !== 2) {
      console.error(
        `FAILED (Scenario B): Expected 2 successful cancellations, got ${differentBookingSuccesses.length}`
      );
      testPassed = false;
    } else {
      console.log("✓ Scenario B passed: Both cancellations succeeded");
    }

    // 8. Verify final seat restoration
    const finalEvent = await getEvent(eventId);
    const finalAvailableSeats = finalEvent.availableSeats;

    // Should have restored all 3 seats (back to original totalSeats)
    if (finalAvailableSeats !== 3) {
      console.error(
        `FAILED (Final seats): Expected 3 available seats, got ${finalAvailableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Final seat count correct: ${finalAvailableSeats} seats available`
      );
    }

    if (testPassed) {
      console.log("\n✅ CANCEL-CONCURRENCY TEST PASSED");
    }
  } catch (err) {
    console.error("FAILED:", err.response?.data || err.message);
    testPassed = false;
  } finally {
    // Cleanup: Delete users and event
    // (cascading deletes will handle bookings and waiting list)
    try {
      console.log("\nCleaning up test data...");

      await Promise.allSettled(userIds.map((userId) => deleteUser(userId)));

      if (eventId) {
        await deleteEvent(eventId);
      }

      console.log("Cleanup completed");
    } catch (cleanupErr) {
      console.error(
        "Cleanup error (non-fatal):",
        cleanupErr.response?.data || cleanupErr.message
      );
    }

    process.exit(testPassed ? 0 : 1);
  }
};

run();
