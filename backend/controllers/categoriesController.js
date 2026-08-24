// controllers/categoriesController.js

const categoriesRepository = require('../database/repositories/categoriesRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

// نفس المعرّف المحجوز في conversationService.js لخيار "خدمة العملاء" الثابت —
// مكرَّر هنا كنص حرفي بدل استيراده لتفادي أي احتمال دورة استيراد لاحقاً؛
// كلاهما يجب أن يبقيا متطابقين حرفياً إن تغيّر أحدهما مستقبلاً.
const RESERVED_CATEGORY_IDS = ['__customer_service__'];

const getAllCategories = asyncHandler(async (req, res) => {
  const categories = categoriesRepository.findAll();
  res.json({ success: true, data: categories });
});

/** يتحقق أن parent_category_id (إن أُرسل) موجود فعلاً ولا يُنشئ حلقة قبل أي كتابة. */
function validateParent(categoryId, parentCategoryId) {
  if (!parentCategoryId) return;

  const parent = categoriesRepository.findById(parentCategoryId);
  if (!parent) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم الأب المحدَّد غير موجود', 400);
  }

  if (categoriesRepository.wouldCreateCycle(categoryId, parentCategoryId)) {
    throw new AppError(
      ErrorCodes.CATEGORY_CYCLE,
      'لا يمكن اختيار هذا القسم كأب — سيُنشئ حلقة (قسم يصبح تابعاً لنفسه بشكل غير مباشر)',
      400
    );
  }
}

const createCategory = asyncHandler(async (req, res) => {
  const { category_id, name, description, display_order, status, parent_category_id } = req.body;

  if (RESERVED_CATEGORY_IDS.includes(category_id)) {
    throw new AppError(ErrorCodes.CATEGORY_ID_EXISTS, 'هذا المعرّف محجوز لخيار "خدمة العملاء" الثابت، اختر معرّفاً آخر', 409);
  }

  const existing = categoriesRepository.findByCategoryId(category_id);
  if (existing) {
    throw new AppError(ErrorCodes.CATEGORY_ID_EXISTS, 'معرف القسم (category_id) مستخدم بالفعل', 409);
  }

  validateParent(null, parent_category_id);

  const category = categoriesRepository.create({
    category_id,
    name,
    description,
    display_order,
    status,
    parent_category_id,
  });
  res.status(201).json({ success: true, data: category });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = categoriesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم غير موجود', 404);
  }

  const { name, description, display_order, status, parent_category_id } = req.body;

  validateParent(Number(id), parent_category_id);

  const updated = categoriesRepository.update(id, { name, description, display_order, status, parent_category_id });
  res.json({ success: true, data: updated });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = categoriesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم غير موجود', 404);
  }

  // نمنعه بوضوح بدل ترك خطأ FK خام يصل للوحة (قاعدة "لا تُظهر أخطاء قاعدة البيانات للمستخدم")
  const linkedCount = categoriesRepository.countLinkedServices(id);
  if (linkedCount > 0) {
    throw new AppError(
      ErrorCodes.CATEGORY_IN_USE,
      `لا يمكن حذف هذا القسم — ${linkedCount} خدمة لا تزال مرتبطة به. أعد تصنيفها أو احذفها أولاً`,
      409
    );
  }

  const childrenCount = categoriesRepository.countChildren(id);
  if (childrenCount > 0) {
    throw new AppError(
      ErrorCodes.CATEGORY_IN_USE,
      `لا يمكن حذف هذا القسم — ${childrenCount} قسم فرعي لا يزال تابعاً له. احذف الأقسام الفرعية أولاً أو انقلها`,
      409
    );
  }

  categoriesRepository.remove(id);
  res.json({ success: true, data: { id: Number(id) } });
});

module.exports = { getAllCategories, createCategory, updateCategory, deleteCategory };
