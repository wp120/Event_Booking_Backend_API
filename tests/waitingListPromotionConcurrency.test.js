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
    title: "Waiting List Promotion Test Event",
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

const createWaitingListRequest = (eventId, userId, noOfSeats) => {
  // Create a booking request that will fail and go to waiting list
  return axios.post(
    `${BASE_URL}/bookings`,
    {
      eventId,
      noOfSeats,
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

const getWaitingList = async (eventId) => {
  const res = await axios.get(`${BASE_URL}/waitingList`);
  return res.data.waitingList.filter((w) => w.eventId === eventId);
};

const getBookings = async (eventId) => {
  const res = await axios.get(`${BASE_URL}/bookings?eventId=${eventId}`);
  return res.data.bookings;
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
  let waitingListIds = [];
  let testPassed = true;

  try {
    // 1. Setup: Create users
    console.log("Setting up test data...");
    const userCount = 8;
    const userResults = await Promise.all(
      Array.from({ length: userCount }, (_, i) => createUser(i + 1))
    );
    userIds = userResults.map((r) => r.data.user._id);

    // 2. Setup: Create event with limited seats
    const eventRes = await createEvent();
    eventId = eventRes.data.event._id;

    // 3. Setup: Create bookings to fill the event (3 seats)
    console.log("Creating bookings to fill event...");
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

    // 4. Setup: Create waiting list entries (3 entries, 1 seat each)
    console.log("Creating waiting list entries...");
    const waitingListResults = await Promise.allSettled(
      userIds.slice(3, 6).map((userId) =>
        createWaitingListRequest(eventId, userId, 1)
      )
    );

    // Extract waiting list IDs from 202 responses
    try {
      waitingListIds = waitingListResults
        .filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 202 &&
            r.value.data?.waitingList
        )
        .map((r) => r.value.data.waitingList._id);
    } catch (err) {
      console.error("Error extracting waiting list IDs:", err);
      waitingListIds = []; // Ensure it's initialized even on error
      throw new Error(`Failed to extract waiting list IDs: ${err.message}`);
    }

    if (waitingListIds.length !== 3) {
      throw new Error(
        `Failed to create 3 waiting list entries. Only created ${waitingListIds.length}`
      );
    }

    // 5. Verify initial state
    const initialEvent = await getEvent(eventId);
    const initialWaitingList = await getWaitingList(eventId);

    if (initialEvent.availableSeats !== 0) {
      throw new Error(
        `Expected 0 available seats after booking, got ${initialEvent.availableSeats}`
      );
    }

    if (initialWaitingList.length !== 3) {
      throw new Error(
        `Expected 3 waiting list entries, got ${initialWaitingList.length}`
      );
    }

    console.log("Test data setup complete. Running concurrency tests...");

    // 6. TEST: Concurrent cancellations to trigger waiting list promotion
    console.log(
      "Testing concurrent cancellations with waiting list promotion..."
    );

    // Cancel 2 bookings concurrently (should promote 2 waiting list entries)
    const cancelResults = await Promise.allSettled([
      cancelBookingRequest(bookingIds[0], userIds[0]),
      cancelBookingRequest(bookingIds[1], userIds[1]),
    ]);

    const cancelSuccesses = cancelResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200
    );

    if (cancelSuccesses.length !== 2) {
      console.error(
        `FAILED: Expected 2 successful cancellations, got ${cancelSuccesses.length}`
      );
      testPassed = false;
    } else {
      console.log("✓ Both cancellations succeeded");
    }

    // 7. Verify waiting list promotion
    // Wait a bit for promotion to complete (transactions should handle this, but adding small delay for safety)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterPromotionEvent = await getEvent(eventId);
    const afterPromotionWaitingList = await getWaitingList(eventId);

    // After cancelling 2 bookings (2 seats freed), 2 waiting list entries should be promoted
    // So: 0 initial + 2 freed - 2 promoted = 0 available seats
    // And: 3 initial - 2 promoted = 1 waiting list entry remaining

    if (afterPromotionEvent.availableSeats !== 0) {
      console.error(
        `FAILED (Seat allocation): Expected 0 available seats after promotion, got ${afterPromotionEvent.availableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Seat allocation correct: ${afterPromotionEvent.availableSeats} seats available`
      );
    }

    if (afterPromotionWaitingList.length !== 1) {
      console.error(
        `FAILED (Waiting list promotion): Expected 1 waiting list entry remaining, got ${afterPromotionWaitingList.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Waiting list promotion correct: ${afterPromotionWaitingList.length} entry remaining`
      );
    }

    // 7b. Verify bookings were created with waitingListId
    const afterPromotionBookings = await getBookings(eventId);
    // We started with 3 bookings, cancelled 2 (deleted), and promoted 2 (created) => still 3 bookings total
    if (afterPromotionBookings.length !== 3) {
      console.error(
        `FAILED (Booking count): Expected 3 bookings, got ${afterPromotionBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Booking count correct: ${afterPromotionBookings.length} bookings`
      );
    }

    // Verify promoted bookings have waitingListId set
    const promotedBookings = afterPromotionBookings.filter(
      (b) => b.waitingListId !== null && b.waitingListId !== undefined
    );
    if (promotedBookings.length !== 2) {
      console.error(
        `FAILED (WaitingListId verification): Expected 2 bookings with waitingListId, got ${promotedBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Promoted bookings have waitingListId: ${promotedBookings.length} bookings`
      );
    }

    // Verify no duplicate waitingListId values
    const promotedWaitingListIds = promotedBookings
      .map((b) => b.waitingListId.toString())
      .filter((id) => id);
    const uniqueWaitingListIds = new Set(promotedWaitingListIds);
    if (promotedWaitingListIds.length !== uniqueWaitingListIds.size) {
      console.error(
        `FAILED (Duplicate waitingListId): Found duplicate waitingListId values`
      );
      testPassed = false;
    } else {
      console.log("✓ No duplicate waitingListId values found");
    }

    // 8. TEST: Cancel remaining booking and verify final promotion
    console.log("Testing final cancellation and promotion...");
    const finalCancelResult = await cancelBookingRequest(
      bookingIds[2],
      userIds[2]
    );

    if (finalCancelResult.status !== 200) {
      console.error(
        `FAILED: Final cancellation failed with status ${finalCancelResult.status}`
      );
      testPassed = false;
    } else {
      console.log("✓ Final cancellation succeeded");
    }

    // Wait for promotion
    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalEvent = await getEvent(eventId);
    const finalWaitingList = await getWaitingList(eventId);

    // After cancelling the last booking (1 seat freed), the last waiting list entry should be promoted
    // So: 0 available + 1 freed - 1 promoted = 0 available seats
    // And: 1 waiting list entry - 1 promoted = 0 waiting list entries

    if (finalEvent.availableSeats !== 0) {
      console.error(
        `FAILED (Final seat allocation): Expected 0 available seats, got ${finalEvent.availableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Final seat allocation correct: ${finalEvent.availableSeats} seats available`
      );
    }

    if (finalWaitingList.length !== 0) {
      console.error(
        `FAILED (Final waiting list): Expected 0 waiting list entries, got ${finalWaitingList.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Final waiting list correct: ${finalWaitingList.length} entries remaining`
      );
    }

    // 9. Verify final booking state
    const finalBookings = await getBookings(eventId);
    // After all cancellations + promotions complete, event should be fully utilized again => 3 bookings total
    if (finalBookings.length !== 3) {
      console.error(
        `FAILED (Final booking count): Expected 3 bookings, got ${finalBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ Final booking count correct: ${finalBookings.length} bookings`
      );
    }

    // Verify all promoted bookings have waitingListId set
    const allPromotedBookings = finalBookings.filter(
      (b) => b.waitingListId !== null && b.waitingListId !== undefined
    );
    if (allPromotedBookings.length !== 3) {
      console.error(
        `FAILED (Final waitingListId verification): Expected 3 bookings with waitingListId, got ${allPromotedBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `✓ All promoted bookings have waitingListId: ${allPromotedBookings.length} bookings`
      );
    }

    // Verify no duplicate waitingListId values (unique index guardrail)
    const allWaitingListIds = allPromotedBookings
      .map((b) => b.waitingListId.toString())
      .filter((id) => id);
    const uniqueAllWaitingListIds = new Set(allWaitingListIds);
    if (allWaitingListIds.length !== uniqueAllWaitingListIds.size) {
      console.error(
        `FAILED (Duplicate waitingListId): Found duplicate waitingListId values in final state`
      );
      testPassed = false;
    } else {
      console.log("✓ No duplicate waitingListId values found (unique index working)");
    }

    if (testPassed) {
      console.log("\n✅ WAITING-LIST-PROMOTION-CONCURRENCY TEST PASSED");
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
