// controllers/customersController.js

const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const whatsappService = require('../services/whatsappService');
const mediaService = require('../services/mediaService');
const { presentCustomer, presentCustomers } = require('../utils/customerPresentation');
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
    data: presentCustomers(result.rows, req),
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
  });
});

const getCustomerById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }

  res.json({ success: true, data: presentCustomer(customer, req) });
});

/** سجل المحادثة الكامل (القسم 6: "عرض المحادثات كاملة") */
const getCustomerMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  assertCanAccessCustomer(req, customer);

  customersRepository.resetUnreadCount(id); // المرحلة 9: فتح المحادثة = رؤيتها، يُصفَّر هذا العميل فقط
  const freshCustomer = customersRepository.findById(id);

  const messages = messagesRepository.findByCustomerId(id);
  res.json({ success: true, data: { customer: presentCustomer(freshCustomer, req), messages } });
});

/** المرحلة 9: تصفير سريع بلا جلب كامل الرسائل — تُستدعى عند وصول حدث Socket لمحادثة مفتوحة بالفعل. */
const markCustomerAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  assertCanAccessCustomer(req, customer);

  customersRepository.resetUnreadCount(id);
  res.json({ success: true, data: { id: Number(id) } });
});

/** رد يدوي مباشر من مدير أو وكيل — خارج آلة حالة البوت تماماً (القسم 6: "استطاعة الرد عليها"). */
const sendCustomerMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const trimmed = (req.body.message || '').trim();

  if (!trimmed && !req.file) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص الرسالة أو مرفق مطلوب', 400);
  }

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  assertCanAccessCustomer(req, customer);

  let result;
  let attachmentType = null;
  let attachmentFilename = null;

  if (req.file) {
    // يرمي AppError عربياً فوراً (400) إن كان النوع/الحجم/الامتداد غير صالح —
    // نفس نمط "نص الرسالة مطلوب" أعلاه، قبل أي محاولة إرسال فعلية
    const category = mediaService.validateAttachment(req.file);
    attachmentFilename = mediaService.saveAttachment(req.file, category);
    attachmentType = category;

    const filePath = mediaService.resolveAttachmentPath(attachmentFilename);
    const uploadResult = await whatsappService.uploadMedia(filePath, req.file.mimetype);

    // فشل الرفع يُعامَل تماماً كفشل الإرسال (يُسجَّل في السجل كمحاولة فاشلة
    // أدناه، لا يُرمى مباشرة) — نفس منطق فشل sendTextMessage في المسار الآخر
    result = uploadResult.success
      ? await whatsappService.sendMediaMessage(customer.phone_number, {
          type: category,
          mediaId: uploadResult.mediaId,
          caption: trimmed || undefined,
          filename: category === 'document' ? req.file.originalname || undefined : undefined,
        })
      : uploadResult;
  } else {
    result = await whatsappService.sendTextMessage(customer.phone_number, trimmed);
  }

  const saved = messagesRepository.create({
    customer_id: customer.id,
    direction: 'outbound',
    message: trimmed || null,
    status: result.success ? 'sent' : 'failed',
    whatsapp_message_id: result.messageId || null,
    sent_by: req.admin.username,
    attachment_type: attachmentType,
    attachment_filename: attachmentFilename,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.WHATSAPP_SEND_FAILED, result.error || 'فشل إرسال الرسالة عبر واتساب', 502);
  }

  res.status(201).json({ success: true, data: saved });
});

// multer المشترك من mediaService، بنفس نمط messagesController.upload وbotSettingsController.upload
const upload = mediaService.upload;

module.exports = { getAllCustomers, getCustomerById, getCustomerMessages, sendCustomerMessage, markCustomerAsRead, upload };
