// controllers/servicesController.js
// CRUD كامل على جدول services. هذه نفس البيانات التي يقرأها البوت
// عبر conversationService — لا يوجد أي تخزين وسيط، كل عملية هنا تُطبَّق
// مباشرة على قاعدة البيانات ذاتها.

const servicesRepository = require('../database/repositories/servicesRepository');
const categoriesRepository = require('../database/repositories/categoriesRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

// نفس معرّف "↩️ رجوع" المحجوز في conversationService.js (المرحلة 1) — مكرَّر هنا
// كنص حرفي بنفس منطق RESERVED_CATEGORY_IDS في categoriesController.js، تفادياً
// لدورة استيراد. service_id غير قابل للتعديل بعد الإنشاء أصلاً (servicesRepository.update
// لا يكتبه)، لذا الفحص هنا في createService فقط يكفي.
const RESERVED_SERVICE_IDS = ['BACK'];

const getAllServices = asyncHandler(async (req, res) => {
  const services = servicesRepository.findAll();
  res.json({ success: true, data: services });
});

function extractServiceFields(body) {
  return {
    service_id: body.service_id,
    name: body.name,
    description: body.description,
    category_id: body.category_id,
    status: body.status,
    reply_type: body.reply_type,
    // input_format/input_prefix/validation_error_message مفيدة فقط عندما
    // reply_type = COLLECT_INPUT؛ إن كانت الخدمة INFO نتجاهلها ونحفظها فارغة
    // حتى لا تبقى بيانات تحقّق قديمة غير مستخدمة معلّقة على خدمة رد ثابت
    input_format: body.reply_type === 'COLLECT_INPUT' ? body.input_format : null,
    input_prefix: body.reply_type === 'COLLECT_INPUT' ? body.input_prefix : null,
    validation_error_message: body.reply_type === 'COLLECT_INPUT' ? body.validation_error_message : null,
    external_api_url: body.reply_type === 'COLLECT_INPUT' ? body.external_api_url : null,
    external_service_code: body.reply_type === 'COLLECT_INPUT' ? body.external_service_code : null,
  };
}

const createService = asyncHandler(async (req, res) => {
  const fields = extractServiceFields(req.body);

  if (RESERVED_SERVICE_IDS.includes(fields.service_id)) {
    throw new AppError(ErrorCodes.SERVICE_ID_EXISTS, 'هذا المعرّف محجوز لزر "رجوع" في قوائم واتساب، اختر معرّفاً آخر', 409);
  }

  const existing = servicesRepository.findByServiceId(fields.service_id);
  if (existing) {
    throw new AppError(ErrorCodes.SERVICE_ID_EXISTS, 'معرف الخدمة (service_id) مستخدم بالفعل', 409);
  }

  if (fields.category_id && !categoriesRepository.findById(fields.category_id)) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم المحدَّد غير موجود', 400);
  }

  const service = servicesRepository.create(fields);
  res.status(201).json({ success: true, data: service });
});

const updateService = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = servicesRepository.findById(id);
  if (!existing) {
    throw new AppError(ErrorCodes.SERVICE_NOT_FOUND, 'الخدمة غير موجودة', 404);
  }

  const fields = extractServiceFields(req.body);

  if (fields.category_id && !categoriesRepository.findById(fields.category_id)) {
    throw new AppError(ErrorCodes.CATEGORY_NOT_FOUND, 'القسم المحدَّد غير موجود', 400);
  }

  const updated = servicesRepository.update(id, fields);
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
