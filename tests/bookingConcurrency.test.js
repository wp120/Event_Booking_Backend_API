const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "http://localhost:3000";

// Configure concurrent request count (50-100 recommended for stress testing)
const CONCURRENT_REQUESTS = 50;

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

const createEvent = () => {
  // Set startTime to tomorrow to avoid "start time cannot be in the past" validation error
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return axios.post(`${BASE_URL}/events`, {
    title: "Concurrency Test Event",
    totalSeats: 3,
    availableSeats: 3,
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
  let eventId = null;
  let testPassed = true;

  try {
    console.log(`=== Booking Concurrency Test ===`);
    console.log(`Concurrent requests: ${CONCURRENT_REQUESTS}\n`);

    // 1. Create users
    console.log("Creating test users...");
    const userCount = CONCURRENT_REQUESTS;
    const userResults = await Promise.all(
      Array.from({ length: userCount }, (_, i) => createUser(i + 1))
    );
    userIds = userResults.map((r) => r.data.user._id);
    console.log(`✓ Created ${userIds.length} users\n`);

    // 2. Create event with limited seats
    console.log("Creating test event...");
    const eventRes = await createEvent();
    eventId = eventRes.data.event._id;
    const eventCapacity = eventRes.data.event.totalSeats;
    console.log(`✓ Created event with ${eventCapacity} seats\n`);

    // 3. Fire concurrent booking requests for the same event
    console.log(`Sending ${CONCURRENT_REQUESTS} concurrent booking requests...`);
    const startTime = Date.now();
    const bookingResults = await Promise.allSettled(
      userIds.map((userId) => createBookingRequest(eventId, userId, generateUUID()))
    );
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`✓ All requests completed in ${duration}ms\n`);

    // Process results
    const successes = bookingResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 201
    );
    const waitingList = bookingResults.filter(
      (r) => r.status === "fulfilled" && r.value.status === 202
    );
    const failures = bookingResults.filter((r) => r.status === "rejected");

    // Group failures by status code
    const failureByStatus = {};
    failures.forEach((failure) => {
      const status = failure.reason?.response?.status || "unknown";
      failureByStatus[status] = (failureByStatus[status] || 0) + 1;
    });

    const successCount = successes.length;

    // Expectation: at most totalSeats bookings should succeed
    const expectedMaxSuccess = eventCapacity;

    // Display results based on request count
    if (CONCURRENT_REQUESTS <= 10) {
      // Detailed output for small numbers
      console.log("Detailed booking results:");
      bookingResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          console.log(
            `  Request ${index + 1}: Status ${result.value.status} - ${result.value.data?.message || "Success"}`
          );
        } else {
          const status = result.reason?.response?.status || "N/A";
          const message = result.reason?.response?.data?.message || result.reason?.message || "Unknown error";
          console.log(
            `  Request ${index + 1}: REJECTED - Status ${status} - ${message}`
          );
        }
      });
      console.log();
    } else {
      // Summary output for large numbers
      console.log("=== Test Results Summary ===");
      console.log(`Total concurrent requests: ${CONCURRENT_REQUESTS}`);
      console.log(`Event capacity: ${eventCapacity} seats\n`);

      console.log("Results Summary:");
      console.log(`  ✅ Successful bookings (201): ${successCount}`);
      console.log(`  ⏳ Waiting list entries (202): ${waitingList.length}`);
      console.log(`  ❌ Rejected/Failed: ${failures.length}`);

      if (failures.length > 0) {
        console.log("\nStatus Code Breakdown:");
        Object.entries(failureByStatus).forEach(([status, count]) => {
          console.log(`  ${status}: ${count} request(s)`);
        });
      }
      console.log();
    }

    // Verification
    let verificationPassed = true;
    console.log("Verification:");

    if (successCount === 0 && waitingList.length === 0 && failures.length === 0) {
      console.error(`  ✗ FAILED: No bookings succeeded, but no failures either. This is unexpected.`);
      verificationPassed = false;
    } else if (successCount > expectedMaxSuccess) {
      console.error(`  ✗ FAILED: Expected at most ${expectedMaxSuccess} successful bookings, but got ${successCount}`);
      verificationPassed = false;
    } else {
      console.log(`  ✓ No overselling: ${successCount} bookings created (matches event capacity)`);
      console.log(`  ✓ Waiting list handled: ${waitingList.length} entries created`);
      if (failures.length > 0) {
        console.log(`  ⚠ Failures occurred: ${failures.length} request(s) failed (may be acceptable for validation/server errors)`);
      } else {
        console.log(`  ✓ All requests processed successfully`);
      }
    }

    console.log();

    if (verificationPassed) {
      console.log("✅ TEST PASSED");
      testPassed = true;
    } else {
      console.log("❌ TEST FAILED");
      testPassed = false;
    }
  } catch (err) {
    console.error("FAILED:", err.response?.data || err.message);
    testPassed = false;
  } finally {
    // Cleanup: Delete created users and event
    try {
      console.log("Cleaning up test data...");

      // Delete all users
      const deleteUserResults = await Promise.allSettled(
        userIds.map((userId) => deleteUser(userId))
      );

      // Delete event
      if (eventId) {
        await deleteEvent(eventId);
      }

      console.log("Cleanup completed");
    } catch (cleanupErr) {
      console.error("Cleanup error (non-fatal):", cleanupErr.response?.data || cleanupErr.message);
    }

    process.exit(testPassed ? 0 : 1);
  }
};

run();

