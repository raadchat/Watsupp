// middleware/validate.js
// يُستدعى بعد سلسلة قواعد express-validator في كل route؛ يحوّل أي فشل تحقق
// إلى AppError بالصيغة الموحدة بدل رسائل express-validator الافتراضية.

const { validationResult } = require('express-validator');
const { AppError, ErrorCodes } = require('../utils/errors');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors
      .array()
      .map((e) => e.msg)
      .join(' — ');
    return next(new AppError(ErrorCodes.VALIDATION_ERROR, message, 400));
  }
  next();
}

module.exports = { handleValidation };
