// utils/errors.js
// خطأ موحّد يحمل رمزاً (code) ورسالة عربية وحالة HTTP، يلتقطه middleware/errorHandler.js
// ويحوّله إلى الصيغة الموحدة: { success: false, error: { code, message } }

class AppError extends Error {
  /**
   * @param {string} code - رمز الخطأ الثابت، مثال: 'SERVICE_NOT_FOUND'
   * @param {string} message - رسالة عربية مناسبة للعرض للمستخدم
   * @param {number} statusCode - حالة HTTP (افتراضياً 400)
   */
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// رموز الأخطاء الثابتة المستخدمة في المشروع، مجمّعة هنا لتفادي تكرار السلاسل النصية
const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  SERVICE_ID_EXISTS: 'SERVICE_ID_EXISTS',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_ID_EXISTS: 'CATEGORY_ID_EXISTS',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  CATEGORY_CYCLE: 'CATEGORY_CYCLE',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  USERNAME_EXISTS: 'USERNAME_EXISTS',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  WHATSAPP_NOT_CONFIGURED: 'WHATSAPP_NOT_CONFIGURED',
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

module.exports = { AppError, ErrorCodes };
