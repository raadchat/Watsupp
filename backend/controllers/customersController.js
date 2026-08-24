// controllers/customersController.js

const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const whatsappService = require('../services/whatsappService');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

/** admin: وصول كامل لأي عميل. agent: فقط للعميل المُسنَد له حالياً في خدمة العملاء. */
function assertCanAccessCustomer(req, customer) {
  if (req.admin.role === 'admin') return;
  if (req.admin.role === 'agent' && customer.assigned_agent_id === req.admin.id) return;
  throw new AppError(ErrorCodes.FORBIDDEN, 'لا تملك صلاحية الوصول لهذه المحادثة', 403);
}

const getAllCustomers = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;

  const result = customersRepository.findAll({
    search: search ? String(search).trim() : undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });

  res.json({
    success: true,
    data: result.rows,
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
  });
});

const getCustomerById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }

  res.json({ success: true, data: customer });
});

/** سجل المحادثة الكامل (القسم 6: "عرض المحادثات كاملة") */
const getCustomerMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  assertCanAccessCustomer(req, customer);

  const messages = messagesRepository.findByCustomerId(id);
  res.json({ success: true, data: { customer, messages } });
});

/** رد يدوي مباشر من مدير أو وكيل — خارج آلة حالة البوت تماماً (القسم 6: "استطاعة الرد عليها"). */
const sendCustomerMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message || !message.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص الرسالة مطلوب', 400);
  }

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  assertCanAccessCustomer(req, customer);

  const trimmed = message.trim();
  const result = await whatsappService.sendTextMessage(customer.phone_number, trimmed);

  const saved = messagesRepository.create({
    customer_id: customer.id,
    direction: 'outbound',
    message: trimmed,
    status: result.success ? 'sent' : 'failed',
    whatsapp_message_id: result.messageId || null,
    sent_by: req.admin.username,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.WHATSAPP_SEND_FAILED, result.error || 'فشل إرسال الرسالة عبر واتساب', 502);
  }

  res.status(201).json({ success: true, data: saved });
});

module.exports = { getAllCustomers, getCustomerById, getCustomerMessages, sendCustomerMessage };
