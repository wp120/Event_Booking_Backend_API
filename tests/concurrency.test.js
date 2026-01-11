const axios = require("axios");

const URL = "http://localhost:3000/bookings";

const sendRequest = (userId) => {
  const payload = {
    eventId: "69634b5afe17f740dd7a02ad",
    noOfSeats: 1,
  };

  axios.post(URL, payload, { headers: { "x-user-id": userId } });
};

const userIds = [
  "69634771a4f63cdc0d41bff1",
  "696347b0a4f63cdc0d41bff3",
  "696347c9a4f63cdc0d41bff5",
  "696347e3a4f63cdc0d41bff7",
];

// Promise.all([sendRequest(), sendRequest(), sendRequest(), sendRequest()])
Promise.all(userIds.map((userId) => sendRequest(userId)))
  .then((res) =>
    console.log(
      "Responses: ",
      res.map((r) => r.status + " " + r.data.message)
    )
  )
  .catch((err) => console.log("Error: ", err.response?.data?.message));
