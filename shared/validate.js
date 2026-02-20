const Joi = require('joi');

/**
 * Express middleware factory for Joi validation.
 * @param {Joi.ObjectSchema} schema - Joi schema to validate req.body against.
 * @param {string} [source='body'] - Request property to validate ('body', 'query', 'params').
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details
        }
      });
    }

    req[source] = value; // Replace with sanitized values
    next();
  };
};

module.exports = { validate };
