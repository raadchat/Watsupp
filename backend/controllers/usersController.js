// controllers/usersController.js
// إدارة وكلاء خدمة العملاء (role='agent') — مقصورة على المدير بالكامل
// (requireAdminRole على مستوى الـ route). القسم 7: "اسمه واسم المستخدم
// وكلمة السر" عند الإضافة، و"نسبة حصوله على النجوم" في القائمة.

const bcrypt = require('bcryptjs'); // نفس واجهة bcrypt، بلا تصريف أصلي
const adminsRepository = require('../database/repositories/adminsRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

/** يحسب متوسط النجوم (من 5) من rating_total/rating_count — null إن لم يُقيَّم بعد. */
function withRatingAverage(agent) {
  const rating_average = agent.rating_count > 0 ? Math.round((agent.rating_total / agent.rating_count) * 10) / 10 : null;
  return { ...agent, rating_average };
}

const getAgents = asyncHandler(async (req, res) => {
  const agents = adminsRepository.findAllAgents().map(withRatingAverage);
  res.json({ success: true, data: agents });
});

const createAgent = asyncHandler(async (req, res) => {
  const { username, name, password } = req.body;

  const existing = adminsRepository.findByUsername(username);
  if (existing) {
    throw new AppError(ErrorCodes.USERNAME_EXISTS, 'اسم المستخدم مستخدم بالفعل', 409);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);

  const agent = adminsRepository.create({ username, password_hash, role: 'agent', name });
  res.status(201).json({ success: true, data: withRatingAverage(agent) });
});

module.exports = { getAgents, createAgent };
