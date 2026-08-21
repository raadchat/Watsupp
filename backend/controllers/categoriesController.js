// controllers/categoriesController.js

const categoriesRepository = require('../database/repositories/categoriesRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const getAllCategories = asyncHandler(async (req, res) => {
  const categories = categoriesRepository.findAll();
  res.json({ success: true, data: categories });
});

const createCategory = asyncHandler(async (req, res) => {
  const { category_id, name, description, display_order, status } = req.body;

  const existing = categoriesRepository.findByCategoryId(category_id);
  if (existing) {
    throw new AppError(ErrorCodes.CATEGORY_ID_EXISTS, 'معرف القسم (category_id) مستخدم بالفعل', 409);
  }

  const category = categoriesRepository.create({ category_id, name, description, display_order, status });
  res.status(201).json({ success: true, data: category });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = categoriesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم غير موجود', 404);
  }

  const { name, description, display_order, status } = req.body;
  const updated = categoriesRepository.update(id, { name, description, display_order, status });
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

  categoriesRepository.remove(id);
  res.json({ success: true, data: { id: Number(id) } });
});

module.exports = { getAllCategories, createCategory, updateCategory, deleteCategory };
