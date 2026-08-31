// controllers/usersController.js
// إدارة المستخدمين (المرحلة 6): admin (صلاحيات كاملة) وagent (خدمة العملاء
// فقط) معاً — مقصورة بالكامل على admin (requireAdminRole على مستوى الـ
// route). الصلاحيات الفعلية بين الدورين مُطبَّقة في الـ Backend في كل مكان
// آخر (middleware/auth.js، وكل route يتحقق من req.admin.role مباشرة) —
// هذا الملف تحديداً هو إدارة *حسابات* المستخدمين نفسها.

const bcrypt = require('bcryptjs'); // نفس واجهة bcrypt، بلا تصريف أصلي
const adminsRepository = require('../database/repositories/adminsRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

/** يحسب متوسط النجوم (من 5) من rating_total/rating_count — null إن لم يُقيَّم بعد. */
function withRatingAverage(user) {
  const rating_average = user.rating_count > 0 ? Math.round((user.rating_total / user.rating_count) * 10) / 10 : null;
  return { ...user, rating_average };
}

const getAllUsers = asyncHandler(async (req, res) => {
  const users = adminsRepository.findAll().map(withRatingAverage);
  res.json({ success: true, data: users });
});

const createUser = asyncHandler(async (req, res) => {
  const { username, name, password, role } = req.body;

  const existing = adminsRepository.findByUsername(username);
  if (existing) {
    throw new AppError(ErrorCodes.USERNAME_EXISTS, 'اسم المستخدم مستخدم بالفعل', 409);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);

  const user = adminsRepository.create({ username, password_hash, role: role || 'agent', name });
  res.status(201).json({ success: true, data: withRatingAverage(user) });
});

/** تعديل الاسم و/أو نوع الحساب — لا يُغيّر اسم المستخدم ولا كلمة المرور (لهما مسارهما الخاص). */
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, role } = req.body;

  const target = adminsRepository.findById(id);
  if (!target) {
    throw new AppError(ErrorCodes.USER_NOT_FOUND, 'المستخدم غير موجود', 404);
  }

  if (role && role !== target.role) {
    if (Number(id) === req.admin.id) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'لا يمكنك تغيير نوع حسابك الخاص', 403);
    }
    if (target.role === 'admin' && role === 'agent' && adminsRepository.countByRole('admin') <= 1) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'لا يمكن تخفيض آخر مدير في النظام إلى وكيل', 403);
    }
  }

  const updated = adminsRepository.update(id, { name, role });
  res.json({ success: true, data: withRatingAverage(updated) });
});

const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const target = adminsRepository.findById(id);
  if (!target) {
    throw new AppError(ErrorCodes.USER_NOT_FOUND, 'المستخدم غير موجود', 404);
  }
  if (Number(id) === req.admin.id) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'لا يمكنك حذف حسابك الخاص أثناء تسجيل دخولك به', 403);
  }
  if (target.role === 'admin' && adminsRepository.countByRole('admin') <= 1) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'لا يمكن حذف آخر مدير في النظام', 403);
  }

  adminsRepository.remove(id);
  res.json({ success: true, data: { id: Number(id) } });
});

/** تغيير كلمة مرور مستخدم آخر من لوحة التحكم (مختلف عن npm run reset-password الطارئ عند فقدان كل الوصول). */
const changeUserPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  const target = adminsRepository.findById(id);
  if (!target) {
    throw new AppError(ErrorCodes.USER_NOT_FOUND, 'المستخدم غير موجود', 404);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);
  adminsRepository.updatePassword(id, password_hash);
  res.json({ success: true, data: { id: Number(id) } });
});

module.exports = { getAllUsers, createUser, updateUser, deleteUser, changeUserPassword };
