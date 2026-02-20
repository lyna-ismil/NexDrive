/**
 * Structured error response factory.
 * Usage: return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Booking not found');
 */
const sendError = (res, statusCode, code, message, details = null) => {
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  return res.status(statusCode).json(body);
};

/**
 * Express global error handler. Mount as last middleware.
 * Usage: app.use(globalErrorHandler);
 */
const globalErrorHandler = (err, req, res, _next) => {
  console.error(`❌ [${req.method} ${req.originalUrl}]`, err.stack || err.message);

  if (err.name === 'ValidationError') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Input validation failed', err.details || err.message);
  }
  if (err.name === 'CastError') {
    return sendError(res, 400, 'INVALID_ID', `Invalid ID format: ${err.value}`);
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern).join(', ');
    return sendError(res, 409, 'DUPLICATE_KEY', `Duplicate value for: ${field}`);
  }

  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
};

module.exports = { sendError, globalErrorHandler };
