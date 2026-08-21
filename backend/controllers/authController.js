// controllers/authController.js

// bcryptjs بدل bcrypt: نفس الواجهة تماماً (hash/compare)، لكنها JS خالص
// بلا أي تصريف أصلي — تتفادى نفس مشكلة node-gyp/Android NDK التي تظهر
// مع الحزم الأصلية على بيئات مثل Termux.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminsRepository = require('../database/repositories/adminsRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  const admin = adminsRepository.findByUsername(username);

  // نفس رسالة الخطأ لعدم وجود المستخدم أو خطأ كلمة المرور، لمنع التخمين
  // (username enumeration) عبر رسائل مختلفة.
  if (!admin) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'اسم المستخدم أو كلمة المرور غير صحيحة', 401);
  }

  const passwordMatches = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatches) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'اسم المستخدم أو كلمة المرور غير صحيحة', 401);
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  res.json({
    success: true,
    data: {
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role },
    },
  });
});

module.exports = { login };
