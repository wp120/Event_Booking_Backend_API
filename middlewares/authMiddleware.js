// middlewares/authMiddleware.js
module.exports = function authMiddleware(req, res, next) {
  // Minimal check example: header must have userId
  if (!req.headers["x-user-id"]) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  // req.body.userId = req.headers["x-user-id"];
  req.body = { ...(req.body || {}), userId: req.headers["x-user-id"] };
  next();
};
