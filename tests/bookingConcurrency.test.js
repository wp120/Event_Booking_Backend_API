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
    title: "Concurrency Test Event",
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
    // 1. Create users
    const userCount = 5;
    const userResults = await Promise.all(
      Array.from({ length: userCount }, (_, i) => createUser(i + 1))
    );
    userIds = userResults.map((r) => r.data.user._id);

    // 2. Create event with limited seats
    const eventRes = await createEvent();
    eventId = eventRes.data.event._id;

    // 3. Fire concurrent booking requests for the same event
    const bookingResults = await Promise.allSettled(
      userIds.map((userId) => createBookingRequest(eventId, userId))
    );

    const successes = bookingResults.filter(
      (r) => {
        return r.status === "fulfilled" && r.value.status === 201
      }
    );
    const failures = bookingResults.filter((r) => {
      return r.status === "rejected"
    });

    const successCount = successes.length;

    // Expectation: at most totalSeats bookings should succeed
    const expectedMaxSuccess = 3;

    if (successCount > expectedMaxSuccess) {
      console.error(
        `FAILED: expected at most ${expectedMaxSuccess} successful bookings, but got ${successCount}`
      );
      testPassed = false;
    } else {
      // Optional: print high-level outcome
      console.log(
        `Booking results - success: ${successCount}, failure: ${failures.length}`
      );
      console.log("PASSED");
      testPassed = true;
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

