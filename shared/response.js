/**
 * Standardized success response helpers.
 * Usage: const { sendSuccess, sendPaginated } = require('../shared/response');
 */

const sendSuccess = (res, data, meta = {}, statusCode = 200) => {
  res.status(statusCode).json({ success: true, data, ...meta });
};

const sendPaginated = (res, data, { total, limit, skip }) => {
  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      limit,
      skip,
      hasMore: skip + data.length < total
    }
  });
};

module.exports = { sendSuccess, sendPaginated };
