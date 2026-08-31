// middleware/errorHandler.js
// نقطة واحدة تحوّل أي خطأ إلى الصيغة الموحدة المطلوبة في المواصفات:
// { success: false, error: { code, message } }
// ولا تُسرّب أبداً تفاصيل قاعدة البيانات أو الـ stack trace للمستخدم.

const { AppError, ErrorCodes, logSafeError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  // أخطاء غير متوقعة (استثناء برمجي، خطأ قاعدة بيانات، ...): تُسجَّل في السيرفر فقط
  logSafeError('[unexpected error]', err);
  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'حدث خطأ في الخادم، حاول مرة أخرى لاحقاً',
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: ErrorCodes.NOT_FOUND, message: 'المسار المطلوب غير موجود' },
  });
}

module.exports = { errorHandler, notFoundHandler };
