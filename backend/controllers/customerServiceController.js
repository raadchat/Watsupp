// controllers/customerServiceController.js
// يدير القسم الثابت "خدمة العملاء" (تفعيل/تسمية)، طابور الانتظار المشترك،
// وإجراءات الوكيل: تولّي محادثة (claim) وإنهاؤها (end → يُرسل دعوة تقييم).
// مفتوح لكل من admin و agent؛ التمييز بينهما في النطاق فقط (agent لا يرى
// إلا ما يخصّه)، ما عدا حفظ الإعدادات (تفعيل/تسمية) المقصور على admin.

const customerServiceSettingsRepository = require('../database/repositories/customerServiceSettingsRepository');
const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const whatsappService = require('../services/whatsappService');
const conversationService = require('../services/conversationService');
const botTexts = require('../services/botTexts');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const getSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: customerServiceSettingsRepository.get() });
});

const saveSettings = asyncHandler(async (req, res) => {
  const { enabled, label } = req.body;
  const saved = customerServiceSettingsRepository.save({ enabled, label });
  res.json({ success: true, data: saved });
});

/** طابور الانتظار العام — مشترك بين كل الوكلاء والمدير (لا "ملكية" قبل claim). */
const getQueue = asyncHandler(async (req, res) => {
  res.json({ success: true, data: customersRepository.findWaitingForAgent() });
});

/** محادثاتي النشطة أنا تحديداً (req.admin.id) — سواء كنت admin أو agent. */
const getMyActiveConversations = asyncHandler(async (req, res) => {
  res.json({ success: true, data: customersRepository.findActiveByAgent(req.admin.id) });
});

/** يُسنِد العميل لي، ويُرسل له إشعار انضمام الوكيل باسمه — القسم 7: "اسم الشخص يتحدث معك". */
const claimConversation = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const customer = customersRepository.findById(customerId);

  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  if (customer.conversation_state !== 'CUSTOMER_SERVICE_WAITING') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'هذه المحادثة ليست بانتظار وكيل حالياً', 409);
  }

  const updated = customersRepository.assignAgent(customer.id, req.admin.id, 'CUSTOMER_SERVICE_ACTIVE');

  const agentName = req.admin.name || req.admin.username;
  const text = botTexts.getText('customerServiceClaimed', { agentName });
  const result = await whatsappService.sendTextMessage(customer.phone_number, text);
  messagesRepository.create({
    customer_id: customer.id,
    direction: 'outbound',
    message: text,
    status: result.success ? 'sent' : 'failed',
    whatsapp_message_id: result.messageId || null,
    sent_by: req.admin.username,
  });

  res.json({ success: true, data: updated });
});

/** إنهاء محادثة خدمة عملاء — يُرسل دعوة تقييم 5 نجوم للعميل (conversationService). */
const endConversation = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const customer = customersRepository.findById(customerId);

  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }
  if (req.admin.role === 'agent' && customer.assigned_agent_id !== req.admin.id) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'لا تملك صلاحية إنهاء هذه المحادثة', 403);
  }

  await conversationService.endCustomerServiceConversation(customer);
  res.json({ success: true, data: { id: customer.id } });
});

module.exports = { getSettings, saveSettings, getQueue, getMyActiveConversations, claimConversation, endConversation };
