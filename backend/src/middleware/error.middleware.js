const logger = require('../utils/logger');

// Central exception catching middleware
const errorMiddleware = (err, req, res, next) => {
  logger.error(`HTTP Route Failure: ${err.message}`, {
    url: req.originalUrl,
    method: req.method,
    stack: err.stack
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Exception';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorMiddleware;
