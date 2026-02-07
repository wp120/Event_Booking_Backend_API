const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "http://localhost:3000";

// Configure concurrent cancellation requests for waiting list promotion test
// Reduced to 25-30 to be more realistic and avoid excessive write conflicts
const CONCURRENT_CANCEL_REQUESTS = 25;

// Generate UUID v4
const generateUUID = () => {
  return crypto.randomUUID();
};

const createUser = (index) => {
  return axios.post(`${BASE_URL}/auth/register`, {
    name: `User ${index}`,
    email: `user${index}@test.com`,
    password: "password123",
  });
};

const createEvent = (totalSeats = 3) => {
  // Set startTime to tomorrow to avoid "start time cannot be in the past" validation error
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return axios.post(`${BASE_URL}/events`, {
    title: "Waiting List Promotion Test Event",
    totalSeats: totalSeats,
    availableSeats: totalSeats,
    startTime: tomorrow.toISOString(),
  });
};

const createBookingRequest = (eventId, userId, idempotencyKey) => {
  return axios.post(
    `${BASE_URL}/bookings`,
    {
      eventId,
      noOfSeats: 1,
    },
    {
      headers: {
        "x-user-id": userId,
        "x-idempotency-key": idempotencyKey,
      },
    }
  );
};

const createWaitingListRequest = (eventId, userId, noOfSeats, idempotencyKey) => {
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
        "x-idempotency-key": idempotencyKey,
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
    console.log(`=== Waiting List Promotion Concurrency Test ===`);
    console.log(`Concurrent cancellation requests: ${CONCURRENT_CANCEL_REQUESTS}\n`);

    // 1. Setup: Create users
    // We need enough users for: bookings + waiting list entries + cancellations
    const bookingsNeeded = CONCURRENT_CANCEL_REQUESTS;
    const waitingListNeeded = CONCURRENT_CANCEL_REQUESTS;
    const userCount = bookingsNeeded + waitingListNeeded + 10; // Extra buffer
    console.log("Setting up test data...");
    console.log(`Creating ${userCount} users...`);
    const userResults = await Promise.all(
      Array.from({ length: userCount }, (_, i) => createUser(i + 1))
    );
    userIds = userResults.map((r) => r.data.user._id);
    console.log(`✓ Created ${userIds.length} users\n`);

    // 2. Setup: Create event with enough seats for concurrent testing
    const eventSeats = bookingsNeeded;
    console.log(`Creating event with ${eventSeats} seats...`);
    const eventRes = await createEvent(eventSeats);
    eventId = eventRes.data.event._id;
    console.log(`✓ Created event\n`);

    // 3. Setup: Create bookings to fill the event
    // Send all requests concurrently using Promise.allSettled (no retry logic in test)
    // Tests should verify correctness, not mask system limitations
    console.log(`Creating ${bookingsNeeded} bookings to fill event...`);
    const bookingResults = await Promise.allSettled(
      userIds.slice(0, bookingsNeeded).map((userId) =>
        createBookingRequest(eventId, userId, generateUUID())
      )
    );

    // Extract results
    const successfulBookings = bookingResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 201
    );
    const failedBookings = bookingResults.filter((r) => r.status === "rejected");
    const waitingListBookings = bookingResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 202
    );

    bookingIds = successfulBookings.map((r) => r.value.data.booking._id);

    // CRITICAL VERIFICATION: No overselling (primary correctness criteria)
    if (bookingIds.length > bookingsNeeded) {
      throw new Error(
        `CRITICAL: Overselling detected! Created ${bookingIds.length} bookings but event capacity is only ${bookingsNeeded}`
      );
    }

    // Log results
    console.log(`  ✅ Successful bookings: ${bookingIds.length}`);
    if (waitingListBookings.length > 0) {
      console.log(`  ⏳ Waiting list entries: ${waitingListBookings.length}`);
    }
    if (failedBookings.length > 0) {
      console.log(`  ❌ Failed requests: ${failedBookings.length}`);
      // Check if failures are due to write conflicts (expected under high concurrency)
      const writeConflictErrors = failedBookings.filter((f) => {
        const message = f.reason?.response?.data?.message || f.reason?.message || "";
        return message.includes("Write conflict") || message.includes("WriteConflict");
      });
      if (writeConflictErrors.length > 0) {
        console.log(`    (${writeConflictErrors.length} write conflicts - expected under high concurrency)`);
      }
    }

    // For this test to proceed, we need enough bookings to cancel
    // If write conflicts prevented us from creating enough, that's a system limitation
    if (bookingIds.length < bookingsNeeded) {
      throw new Error(
        `Test setup failed: Only created ${bookingIds.length} out of ${bookingsNeeded} bookings needed. ` +
        `This indicates the system cannot handle ${bookingsNeeded} concurrent requests. ` +
        `Consider reducing CONCURRENT_CANCEL_REQUESTS or improving system retry logic.`
      );
    }

    console.log(`✓ Created ${bookingIds.length} bookings\n`);

    // 4. Setup: Create waiting list entries
    console.log(`Creating ${waitingListNeeded} waiting list entries...`);
    const waitingListResults = await Promise.allSettled(
      userIds.slice(bookingsNeeded, bookingsNeeded + waitingListNeeded).map((userId) =>
        createWaitingListRequest(eventId, userId, 1, generateUUID())
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

    if (waitingListIds.length !== waitingListNeeded) {
      throw new Error(
        `Failed to create ${waitingListNeeded} waiting list entries. Only created ${waitingListIds.length}`
      );
    }
    console.log(`✓ Created ${waitingListIds.length} waiting list entries\n`);

    // 5. Verify initial state
    console.log("Verifying initial state...");
    const initialEvent = await getEvent(eventId);
    const initialWaitingList = await getWaitingList(eventId);

    if (initialEvent.availableSeats !== 0) {
      throw new Error(
        `Expected 0 available seats after booking, got ${initialEvent.availableSeats}`
      );
    }

    if (initialWaitingList.length !== waitingListNeeded) {
      throw new Error(
        `Expected ${waitingListNeeded} waiting list entries, got ${initialWaitingList.length}`
      );
    }
    console.log("✓ Initial state verified\n");
    console.log("Test data setup complete. Running concurrency tests...\n");

    // 6. TEST: Concurrent cancellations to trigger waiting list promotion
    console.log(`\n=== Concurrent Cancellations with Waiting List Promotion ===`);
    console.log(`Concurrent cancellation requests: ${CONCURRENT_CANCEL_REQUESTS}\n`);

    // Create enough bookings to cancel concurrently
    // We need at least CONCURRENT_CANCEL_REQUESTS bookings, but we only have 3 initially
    // So we'll cancel the 2 we have, and create more bookings first if needed
    const bookingsToCancel = Math.min(CONCURRENT_CANCEL_REQUESTS, bookingIds.length);

    if (bookingsToCancel < CONCURRENT_CANCEL_REQUESTS) {
      console.log(`Note: Only ${bookingsToCancel} bookings available to cancel (event has ${bookingIds.length} bookings)`);
      console.log(`Testing with ${bookingsToCancel} concurrent cancellations instead of ${CONCURRENT_CANCEL_REQUESTS}\n`);
    }

    console.log(`Sending ${bookingsToCancel} concurrent cancellation requests...`);
    const startTime = Date.now();
    const cancelResults = await Promise.allSettled(
      bookingIds.slice(0, bookingsToCancel).map((bookingId, index) =>
        cancelBookingRequest(bookingId, userIds[index])
      )
    );
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`✓ All requests completed in ${duration}ms\n`);

    const cancelSuccesses = cancelResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200
    );
    const cancelFailures = cancelResults.filter((r) => r.status === "rejected");

    // Display results
    if (bookingsToCancel <= 10) {
      console.log("Detailed results:");
      cancelResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          console.log(`  Request ${index + 1}: Status ${result.value.status} - Cancellation successful`);
        } else {
          const status = result.reason?.response?.status || "N/A";
          const message = result.reason?.response?.data?.message || result.reason?.message || "Unknown error";
          console.log(`  Request ${index + 1}: REJECTED - Status ${status} - ${message}`);
        }
      });
      console.log();
    } else {
      console.log("Results Summary:");
      console.log(`  ✅ Successful cancellations (200): ${cancelSuccesses.length}`);
      console.log(`  ❌ Failed: ${cancelFailures.length}`);
      console.log();
    }

    console.log("Verification:");
    if (cancelSuccesses.length !== bookingsToCancel) {
      console.error(
        `  ✗ FAILED: Expected ${bookingsToCancel} successful cancellations, got ${cancelSuccesses.length}`
      );
      testPassed = false;
    } else {
      console.log(`  ✓ All ${cancelSuccesses.length} cancellations succeeded`);
    }
    console.log();

    // 7. Verify waiting list promotion
    // Wait a bit for promotion to complete (transactions should handle this, but adding small delay for safety)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterPromotionEvent = await getEvent(eventId);
    const afterPromotionWaitingList = await getWaitingList(eventId);

    // After cancelling bookings, waiting list entries should be promoted
    // Expected: bookingsToCancel seats freed, bookingsToCancel waiting list entries promoted
    const expectedRemainingWaitingList = waitingListNeeded - bookingsToCancel;
    const expectedAvailableSeats = 0; // All seats should be filled after promotion

    console.log("Verification:");
    if (afterPromotionEvent.availableSeats !== expectedAvailableSeats) {
      console.error(
        `  ✗ FAILED (Seat allocation): Expected ${expectedAvailableSeats} available seats after promotion, got ${afterPromotionEvent.availableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Seat allocation correct: ${afterPromotionEvent.availableSeats} seats available`
      );
    }

    if (afterPromotionWaitingList.length !== expectedRemainingWaitingList) {
      console.error(
        `  ✗ FAILED (Waiting list promotion): Expected ${expectedRemainingWaitingList} waiting list entries remaining, got ${afterPromotionWaitingList.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Waiting list promotion correct: ${afterPromotionWaitingList.length} entry(ies) remaining`
      );
    }

    // 7b. Verify bookings were created with waitingListId
    const afterPromotionBookings = await getBookings(eventId);
    // We started with bookingsNeeded bookings, cancelled bookingsToCancel, and promoted bookingsToCancel => still bookingsNeeded bookings total
    const expectedBookingCount = bookingsNeeded;
    if (afterPromotionBookings.length !== expectedBookingCount) {
      console.error(
        `  ✗ FAILED (Booking count): Expected ${expectedBookingCount} bookings, got ${afterPromotionBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Booking count correct: ${afterPromotionBookings.length} bookings`
      );
    }

    // Verify promoted bookings have waitingListId set
    const promotedBookings = afterPromotionBookings.filter(
      (b) => b.waitingListId !== null && b.waitingListId !== undefined
    );
    if (promotedBookings.length !== bookingsToCancel) {
      console.error(
        `  ✗ FAILED (WaitingListId verification): Expected ${bookingsToCancel} bookings with waitingListId, got ${promotedBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Promoted bookings have waitingListId: ${promotedBookings.length} bookings`
      );
    }
    console.log();

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

    // 8. TEST: Cancel remaining bookings and verify final promotion
    // Cancel all remaining bookings (if any)
    const remainingBookings = bookingIds.slice(bookingsToCancel);
    if (remainingBookings.length > 0) {
      console.log(`Testing final cancellation and promotion (${remainingBookings.length} remaining booking(s))...`);
      const finalCancelResults = await Promise.allSettled(
        remainingBookings.map((bookingId, index) =>
          cancelBookingRequest(bookingId, userIds[bookingsToCancel + index])
        )
      );

      const finalCancelSuccesses = finalCancelResults.filter(
        (r) => r.status === "fulfilled" && r.value.status === 200
      );

      if (finalCancelSuccesses.length !== remainingBookings.length) {
        console.error(
          `  ✗ FAILED: Expected ${remainingBookings.length} successful cancellations, got ${finalCancelSuccesses.length}`
        );
        testPassed = false;
      } else {
        console.log(`  ✓ All ${finalCancelSuccesses.length} final cancellations succeeded`);
      }
      console.log();
    }

    // Wait for promotion
    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalEvent = await getEvent(eventId);
    const finalWaitingList = await getWaitingList(eventId);

    // After all cancellations, all waiting list entries should be promoted
    // Expected: 0 available seats, 0 waiting list entries
    console.log("Final State Verification:");
    if (finalEvent.availableSeats !== 0) {
      console.error(
        `  ✗ FAILED (Final seat allocation): Expected 0 available seats, got ${finalEvent.availableSeats}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Final seat allocation correct: ${finalEvent.availableSeats} seats available`
      );
    }

    if (finalWaitingList.length !== 0) {
      console.error(
        `  ✗ FAILED (Final waiting list): Expected 0 waiting list entries, got ${finalWaitingList.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Final waiting list correct: ${finalWaitingList.length} entries remaining`
      );
    }

    // 9. Verify final booking state
    const finalBookings = await getBookings(eventId);
    // After all cancellations + promotions complete, event should be fully utilized again
    if (finalBookings.length !== bookingsNeeded) {
      console.error(
        `  ✗ FAILED (Final booking count): Expected ${bookingsNeeded} bookings, got ${finalBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ Final booking count correct: ${finalBookings.length} bookings`
      );
    }

    // Verify all promoted bookings have waitingListId set
    const allPromotedBookings = finalBookings.filter(
      (b) => b.waitingListId !== null && b.waitingListId !== undefined
    );
    if (allPromotedBookings.length !== bookingsNeeded) {
      console.error(
        `  ✗ FAILED (Final waitingListId verification): Expected ${bookingsNeeded} bookings with waitingListId, got ${allPromotedBookings.length}`
      );
      testPassed = false;
    } else {
      console.log(
        `  ✓ All promoted bookings have waitingListId: ${allPromotedBookings.length} bookings`
      );
    }
    console.log();

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
