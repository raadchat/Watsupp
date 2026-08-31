// controllers/botTextsController.js
// المرحلة 4 — قراءة/تعديل النصوص والأزرار الثابتة الموجَّهة للعميل على
// واتساب. الصلاحية مقصورة بالكامل على admin على مستوى الـ route (راجع
// routes/botTexts.js) — Agent لا يستطيع حتى عرض هذه الصفحة، فضلاً عن تعديلها.

const botTexts = require('../services/botTexts');
const botTextsRepository = require('../database/repositories/botTextsRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const getBotTexts = asyncHandler(async (req, res) => {
  res.json({ success: true, data: botTexts.listForAdmin() });
});

/** body: { texts: { key: value, ... } } — قيمة فارغة تُعيد ذلك المفتاح لنصه الافتراضي. */
const saveBotTexts = asyncHandler(async (req, res) => {
  const entries = req.body?.texts;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'صيغة الطلب غير صحيحة', 400);
  }

  const unknownKeys = Object.keys(entries).filter((key) => !botTexts.isValidKey(key));
  if (unknownKeys.length > 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `مفاتيح غير معروفة: ${unknownKeys.join('، ')}`, 400);
  }

  botTextsRepository.setMany(entries);
  res.json({ success: true, data: botTexts.listForAdmin() });
});

module.exports = { getBotTexts, saveBotTexts };
