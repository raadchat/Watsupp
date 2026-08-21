// middleware/auth.js
// يحمي مسارات الإدارة: يرفض 401 إذا كان التوكن مفقوداً أو غير صالح أو منتهياً،
// ويسمح بالمرور فقط إذا كان صالحاً — تماماً كما هو محدد في المواصفات.

const jwt = require('jsonwebtoken');
const { AppError, ErrorCodes } = require('../utils/errors');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(ErrorCodes.UNAUTHORIZED, 'رمز الدخول مفقود', 401));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      // نفس رمز الخطأ لكل من: توكن غير صالح، أو منتهي الصلاحية (jwt.TokenExpiredError)
      return next(
        new AppError(ErrorCodes.UNAUTHORIZED, 'رمز الدخول غير صالح أو منتهي الصلاحية', 401)
      );
    }
    req.admin = decoded; // { id, username, role, iat, exp }
    next();
  });
}

module.exports = { authenticateToken };
