"use strict";

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: result.error.errors,
      });
    }

    req.body = result.data;
    return next();
  };
}

module.exports = validate;
