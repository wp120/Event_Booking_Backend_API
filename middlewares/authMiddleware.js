module.exports = function authMiddleware(req, res, next) {
  if (!req.headers["x-user-id"]) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  // req.body.userId = req.headers["x-user-id"];
  // above line fails if req.body is undefined. That's why it's replaced by below line.
  req.body = { ...(req.body || {}), userId: req.headers["x-user-id"] };
  next();
};
