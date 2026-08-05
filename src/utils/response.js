const sendSuccess = (res, statusCode, message, data = {}) => {
  res.status(statusCode).json({ status: 'success', message, data });
};

const sendError = (res, statusCode, message) => {
  res.status(statusCode).json({ status: 'fail', message });
};

module.exports = { sendSuccess, sendError };
