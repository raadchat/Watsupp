// middleware/rateLimiter.js
// حدّان منفصلان: عام لكل /api، وأشد عليه بكثير لمسار تسجيل الدخول تحديداً
// لإبطاء محاولات تخمين كلمة المرور (brute force).

const rateLimit = require('express-rate-limit');
const { ErrorCodes } = require('../utils/errors');

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 دقيقة افتراضياً

const rateLimitResponse = (message) => ({
  success: false,
  error: { code: ErrorCodes.RATE_LIMIT_EXCEEDED, message },
});

const generalLimiter = rateLimit({
  windowMs,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('عدد كبير جداً من الطلبات، حاول مرة أخرى لاحقاً'),
});

const loginLimiter = rateLimit({
  windowMs,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('محاولات دخول كثيرة جداً، حاول مرة أخرى بعد قليل'),
});

module.exports = { generalLimiter, loginLimiter };
