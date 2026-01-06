/**
 * Standardized API response helpers
 */

const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data
  });
};

const created = (res, data) => {
  return success(res, data, 201);
};

const noContent = (res) => {
  return res.status(204).send();
};

const error = (res, message, statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    error: message
  });
};

const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, 401);
};

const forbidden = (res, message = 'Forbidden') => {
  return error(res, message, 403);
};

const notFound = (res, message = 'Not found') => {
  return error(res, message, 404);
};

const serverError = (res, err) => {
  console.error(err);
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;
  return error(res, message, 500);
};

module.exports = {
  success,
  created,
  noContent,
  error,
  unauthorized,
  forbidden,
  notFound,
  serverError
};
