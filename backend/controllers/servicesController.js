// controllers/servicesController.js
// CRUD كامل على جدول services. هذه نفس البيانات التي يقرأها البوت
// عبر conversationService — لا يوجد أي تخزين وسيط، كل عملية هنا تُطبَّق
// مباشرة على قاعدة البيانات ذاتها.

const servicesRepository = require('../database/repositories/servicesRepository');
const categoriesRepository = require('../database/repositories/categoriesRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const getAllServices = asyncHandler(async (req, res) => {
  const services = servicesRepository.findAll();
  res.json({ success: true, data: services });
});

const createService = asyncHandler(async (req, res) => {
  const { service_id, name, description, category_id, status } = req.body;

  const existing = servicesRepository.findByServiceId(service_id);
  if (existing) {
    throw new AppError(ErrorCodes.SERVICE_ID_EXISTS, 'معرف الخدمة (service_id) مستخدم بالفعل', 409);
  }

  if (category_id && !categoriesRepository.findById(category_id)) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم المحدَّد غير موجود', 400);
  }

  const service = servicesRepository.create({ service_id, name, description, category_id, status });
  res.status(201).json({ success: true, data: service });
});

const updateService = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = servicesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.SERVICE_NOT_FOUND, 'الخدمة غير موجودة', 404);
  }

  const { name, description, category_id, status } = req.body;

  if (category_id && !categoriesRepository.findById(category_id)) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم المحدَّد غير موجود', 400);
  }

  const updated = servicesRepository.update(id, { name, description, category_id, status });
  res.json({ success: true, data: updated });
});

const deleteService = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = servicesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.SERVICE_NOT_FOUND, 'الخدمة غير موجودة', 404);
  }

  servicesRepository.remove(id);
  res.json({ success: true, data: { id: Number(id) } });
});

module.exports = { getAllServices, createService, updateService, deleteService };
