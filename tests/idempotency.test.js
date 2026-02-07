const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "http://localhost:3000";

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

const createEvent = (totalSeats) => {
  // Set startTime to tomorrow to avoid "start time cannot be in the past" validation error
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return axios.post(`${BASE_URL}/events`, {
    title: "Idempotency Test Event",
    totalSeats: totalSeats || 10,
    availableSeats: totalSeats || 10,
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

const deleteUser = (userId) => {
  return axios.delete(`${BASE_URL}/auth/${userId}`);
};

const deleteEvent = (eventId) => {
  return axios.delete(`${BASE_URL}/events/${eventId}`);
};

const run = async () => {
  let userIds = [];
  let eventIds = [];
  let testPassed = true;

  try {
    console.log("=== Idempotency Key Feature Test ===\n");

    // Test 1: Create user and event
    console.log("Test 1: Creating test user and event...");
    const userRes = await createUser(1);
    const userId = userRes.data.user._id;
    userIds.push(userId);

    const eventRes = await createEvent(5);
    const eventId = eventRes.data.event._id;
    eventIds.push(eventId);
    console.log("✓ User and event created\n");

    // Test 2: Missing idempotency key should return 400
    console.log("Test 2: Testing missing idempotency key...");
    try {
      await axios.post(
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
      console.error("  ✗ FAILED: Should have returned 400 for missing idempotency key");
      testPassed = false;
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.message?.includes("idempotencyKey")) {
        console.log("  ✓ PASSED: Correctly returned 400 for missing idempotency key");
      } else {
        console.error(`  ✗ FAILED: Expected 400, got ${error.response?.status}`);
        testPassed = false;
      }
    }
    console.log();

    // Test 3: Invalid UUID format should return 400
    console.log("Test 3: Testing invalid UUID format...");
    try {
      await axios.post(
        `${BASE_URL}/bookings`,
        {
          eventId,
          noOfSeats: 1,
        },
        {
          headers: {
            "x-user-id": userId,
            "x-idempotency-key": "invalid-uuid",
          },
        }
      );
      console.error("  ✗ FAILED: Should have returned 400 for invalid UUID format");
      testPassed = false;
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.message?.includes("Invalid idempotencyKey format")) {
        console.log("  ✓ PASSED: Correctly returned 400 for invalid UUID format");
      } else {
        console.error(`  ✗ FAILED: Expected 400, got ${error.response?.status}`);
        testPassed = false;
      }
    }
    console.log();

    // Test 4: Same idempotency key should return same booking (status 200 on subsequent requests)
    console.log("Test 4: Testing idempotency for successful booking...");
    const idempotencyKey1 = generateUUID();

    // First request - should create booking (status 201)
    const firstRequest = await createBookingRequest(eventId, userId, idempotencyKey1);
    if (firstRequest.status !== 201) {
      console.error(`  ✗ FAILED: First request should return 201, got ${firstRequest.status}`);
      testPassed = false;
    } else {
      console.log("  ✓ First request returned 201 (booking created)");
      const firstBookingId = firstRequest.data.booking._id;

      // Second request with same idempotency key - should return existing booking (status 200)
      const secondRequest = await createBookingRequest(eventId, userId, idempotencyKey1);
      if (secondRequest.status !== 200) {
        console.error(`  ✗ FAILED: Second request should return 200, got ${secondRequest.status}`);
        testPassed = false;
      } else if (secondRequest.data.booking._id !== firstBookingId) {
        console.error("  ✗ FAILED: Second request returned different booking ID");
        testPassed = false;
      } else {
        console.log("  ✓ Second request returned 200 with same booking (idempotent)");

        // Third request - should also return same booking
        const thirdRequest = await createBookingRequest(eventId, userId, idempotencyKey1);
        if (thirdRequest.status === 200 && thirdRequest.data.booking._id === firstBookingId) {
          console.log("  ✓ Third request also returned same booking (idempotent)");
        } else {
          console.error("  ✗ FAILED: Third request did not return same booking");
          testPassed = false;
        }
      }
    }
    console.log();

    // Test 5: Different idempotency keys should create different bookings
    console.log("Test 5: Testing different idempotency keys create different bookings...");
    const idempotencyKey2 = generateUUID();
    const idempotencyKey3 = generateUUID();

    const booking2 = await createBookingRequest(eventId, userId, idempotencyKey2);
    const booking3 = await createBookingRequest(eventId, userId, idempotencyKey3);

    // Both should succeed (either 201 for booking or 202 for waiting list)
    if ((booking2.status === 201 || booking2.status === 202) && (booking3.status === 201 || booking3.status === 202)) {
      // If both are bookings, they should have different IDs
      if (booking2.status === 201 && booking3.status === 201) {
        if (booking2.data.booking._id !== booking3.data.booking._id) {
          console.log("  ✓ PASSED: Different idempotency keys created different bookings");
        } else {
          console.error("  ✗ FAILED: Different idempotency keys returned same booking");
          testPassed = false;
        }
      } else if (booking2.status === 202 && booking3.status === 202) {
        // If both are waiting list entries, they should have different IDs
        if (booking2.data.waitingList._id !== booking3.data.waitingList._id) {
          console.log("  ✓ PASSED: Different idempotency keys created different waiting list entries");
        } else {
          console.error("  ✗ FAILED: Different idempotency keys returned same waiting list entry");
          testPassed = false;
        }
      } else {
        // One is booking, one is waiting list - that's fine, they're different
        console.log("  ✓ PASSED: Different idempotency keys created different records (one booking, one waiting list)");
      }
    } else {
      console.error(`  ✗ FAILED: Could not create bookings. Status: ${booking2.status}, ${booking3.status}`);
      testPassed = false;
    }
    console.log();

    // Test 6: Idempotency for waiting list entries
    console.log("Test 6: Testing idempotency for waiting list entries...");
    // Create event with no available seats
    const fullEventRes = await createEvent(1);
    const fullEventId = fullEventRes.data.event._id;
    eventIds.push(fullEventId);

    // Book the only seat
    await createBookingRequest(fullEventId, userId, generateUUID());

    const waitingListKey = generateUUID();

    // First request - should add to waiting list (status 202)
    const firstWaitRequest = await createBookingRequest(fullEventId, userId, waitingListKey);
    if (firstWaitRequest.status !== 202) {
      console.error(`  ✗ FAILED: First request should return 202, got ${firstWaitRequest.status}`);
      testPassed = false;
    } else {
      console.log("  ✓ First request returned 202 (added to waiting list)");
      const firstWaitingListId = firstWaitRequest.data.waitingList._id;

      // Second request with same idempotency key - should return existing waiting list entry (status 200)
      const secondWaitRequest = await createBookingRequest(fullEventId, userId, waitingListKey);
      if (secondWaitRequest.status !== 200) {
        console.error(`  ✗ FAILED: Second request should return 200, got ${secondWaitRequest.status}`);
        testPassed = false;
      } else if (secondWaitRequest.data.waitingList._id !== firstWaitingListId) {
        console.error("  ✗ FAILED: Second request returned different waiting list ID");
        testPassed = false;
      } else {
        console.log("  ✓ Second request returned 200 with same waiting list entry (idempotent)");
      }
    }
    console.log();

    // Test 7: Concurrent requests with same idempotency key should only create one booking
    console.log("Test 7: Testing concurrent requests with same idempotency key...");
    const CONCURRENT_IDEMPOTENCY_REQUESTS = 50;
    const concurrentKey = generateUUID();
    const concurrentEventRes = await createEvent(10);
    const concurrentEventId = concurrentEventRes.data.event._id;
    eventIds.push(concurrentEventId);

    console.log(`  Sending ${CONCURRENT_IDEMPOTENCY_REQUESTS} concurrent requests with same idempotency key...`);
    const startTime = Date.now();
    const concurrentResults = await Promise.allSettled(
      Array.from({ length: CONCURRENT_IDEMPOTENCY_REQUESTS }, () => createBookingRequest(concurrentEventId, userId, concurrentKey))
    );
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`  ✓ All requests completed in ${duration}ms\n`);

    const successful = concurrentResults.filter(
      (r) => r.status === "fulfilled" && (r.value.status === 201 || r.value.status === 200)
    );
    const failed = concurrentResults.filter((r) => r.status === "rejected");

    // Display results
    if (CONCURRENT_IDEMPOTENCY_REQUESTS <= 10) {
      console.log("  Detailed results:");
      concurrentResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          console.log(`    Request ${index + 1}: Status ${result.value.status}`);
        } else {
          const status = result.reason?.response?.status || "N/A";
          const message = result.reason?.response?.data?.message || result.reason?.message || "Unknown error";
          console.log(`    Request ${index + 1}: REJECTED - Status ${status} - ${message}`);
        }
      });
      console.log();
    } else {
      const created = successful.filter((r) => r.value.status === 201);
      const idempotent = successful.filter((r) => r.value.status === 200);

      console.log("  Results Summary:");
      console.log(`    ✅ Created (201): ${created.length}`);
      console.log(`    ✅ Idempotent (200): ${idempotent.length}`);
      console.log(`    ❌ Failed: ${failed.length}`);
      console.log();
    }

    // Verification
    if (successful.length === 0) {
      console.error(`  ✗ FAILED: All ${concurrentResults.length} concurrent requests failed`);
      testPassed = false;
    } else if (failed.length > 0) {
      console.error(`  ✗ FAILED: ${failed.length} out of ${concurrentResults.length} requests failed`);
      testPassed = false;
    } else {
      // All requests should have succeeded
      const created = successful.filter((r) => r.value.status === 201);
      const idempotent = successful.filter((r) => r.value.status === 200);

      // At least one should have created (201), rest should be idempotent (200)
      if (created.length >= 1 && idempotent.length === successful.length - created.length) {
        // All successful requests should return the same booking ID
        const bookingIds = successful
          .map((r) => r.value.data.booking?._id)
          .filter((id) => id !== undefined);

        if (bookingIds.length === successful.length) {
          const uniqueIds = new Set(bookingIds);
          if (uniqueIds.size === 1) {
            console.log(`  ✓ PASSED: ${created.length} request(s) created booking, ${idempotent.length} returned idempotent - all with same booking ID`);
          } else {
            console.error(`  ✗ FAILED: Concurrent requests returned ${uniqueIds.size} different bookings`);
            testPassed = false;
          }
        } else {
          console.error("  ✗ FAILED: Not all successful responses contain booking IDs");
          testPassed = false;
        }
      } else {
        console.error(`  ✗ FAILED: Expected at least 1 created (201) and rest idempotent (200), got ${created.length} created, ${idempotent.length} idempotent`);
        testPassed = false;
      }
    }
    console.log();

    // Final result
    if (testPassed) {
      console.log("=== ALL TESTS PASSED ===");
    } else {
      console.log("=== SOME TESTS FAILED ===");
    }
  } catch (err) {
    console.error("FAILED:", err.response?.data || err.message);
    testPassed = false;
  } finally {
    // Cleanup: Delete created users and events
    try {
      console.log("\nCleaning up test data...");

      // Delete all users
      const deleteUserResults = await Promise.allSettled(
        userIds.map((userId) => deleteUser(userId))
      );

      // Delete all events
      const deleteEventResults = await Promise.allSettled(
        eventIds.map((eventId) => deleteEvent(eventId))
      );

      console.log("Cleanup completed");
    } catch (cleanupErr) {
      console.error("Cleanup error (non-fatal):", cleanupErr.response?.data || cleanupErr.message);
    }

    process.exit(testPassed ? 0 : 1);
  }
};

run();
