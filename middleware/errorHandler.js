module.exports = (err, req, res, next) => {
  console.error("Unhandled error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({ error: message });
};

