const axios = require("axios");

const URL = "http://localhost:3000/bookings";

const sendRequest = (userId) => {
  const payload = {
    eventId: "69635f3fd7a20f2e504d7859",
    noOfSeats: 1,
  };

  return axios.post(URL, payload, { headers: { "x-user-id": userId } });
};

const userIds = [
  "69635b47f0e40a452f7e3b3e",
  "69635b64845c19f495df383f",
  "69635b875bf83c73e9b9453b",
  "69635b9d84963d0202592e9c",
];

//Promise.allSettled is used instead of Promise.all because we need to print responses of all requests irrespective of fullfilled or rejected.

Promise.allSettled(userIds.map((userId) => sendRequest(userId))).then(
  (results) => {
    console.log(
      results.map((r) =>
        r.status === "fulfilled"
          ? `${r.value.status} ${r.value.data.message}`
          : `${r.reason.response.status} ${r.reason.response.data.message}`
      )
    );
  }
);
