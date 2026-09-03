// controllers/webhookController.js
// تطبيق التسلسل: العميل → WhatsApp → Webhook → Node.js → تحليل الرسالة →
// Database → تحديد الاستجابة → Services → WhatsApp API → العميل (القسم 9).

const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const whatsappSettingsRepository = require('../database/repositories/whatsappSettingsRepository');
const conversationService = require('../services/conversationService');
const { logSafeError } = require('../utils/errors');

/**
 * GET /webhook
 * التحقق الأولي المطلوب من Meta عند ربط الـ webhook في لوحة تحكم المطورين:
 * ترسل Meta hub.mode و hub.verify_token و hub.challenge، ونتحقق أن التوكن
 * يطابق verify_token المحفوظ حالياً (من لوحة التحكم أو .env كتراجع) قبل
 * إعادة hub.challenge كما هو.
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = whatsappSettingsRepository.get();
  const expectedToken = settings?.verify_token;

  if (mode === 'subscribe' && expectedToken && token === expectedToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

/**
 * يستخرج من جسم الـ payload القادم من Meta أول رسالة واردة فعلية (إن وجدت).
 * تُرسل Meta أيضاً إشعارات حالة (delivered/read) على نفس المسار وهذه ليست
 * رسائل عميل، لذلك نتجاهلها بأمان إذا لم يوجد حقل messages.
 */
function extractIncomingMessage(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  return value?.messages?.[0] || null;
}

/**
 * POST /webhook
 * يجب الرد بسرعة (200) على Meta بغض النظر عن نتيجة المعالجة الداخلية، وإلا
 * تُعيد Meta المحاولة/تعتبر الـ webhook متعطلاً. المعالجة الفعلية تُكمَل بعد الرد.
 */
async function handleIncomingMessage(req, res) {
  res.sendStatus(200);

  try {
    const message = extractIncomingMessage(req.body);
    if (!message) return; // إشعار حالة وليس رسالة عميل — لا شيء لفعله

    const fromPhoneNumber = message.from;

    let customer = customersRepository.findByPhone(fromPhoneNumber);
    if (!customer) {
      customer = customersRepository.create({ phone_number: fromPhoneNumber });
    }

    let incomingText = null;
    let selectedId = null; // قد يكون معرّف قسم أو خدمة — conversationService يفسّره حسب حالة العميل الحالية

    if (message.type === 'text') {
      incomingText = message.text?.body || null;
    } else if (message.type === 'interactive') {
      if (message.interactive?.type === 'list_reply') {
        selectedId = message.interactive.list_reply?.id || null;
      } else if (message.interactive?.type === 'button_reply') {
        incomingText = message.interactive.button_reply?.id || null;
      }
    }

    const savedMessage = messagesRepository.create({
      customer_id: customer.id,
      direction: 'inbound',
      message: incomingText || selectedId || `[${message.type}]`,
      status: 'received',
      whatsapp_message_id: message.id || null,
    });

    customersRepository.updateLastContact(customer.id);

    await conversationService.handleMessage(customer, { text: incomingText, selectedId });

    // المرحلة 9: البوت لا يتدخل إطلاقاً أثناء CUSTOMER_SERVICE_ACTIVE (يعود
    // فوراً من conversationService.handleMessage)، فحالة customer المحمَّلة
    // أعلاه تعكس الوضع الفعلي بدقة هنا — لا حاجة لإعادة قراءتها من القاعدة.
    if (customer.conversation_state === 'CUSTOMER_SERVICE_ACTIVE' && customer.assigned_agent_id) {
      const updatedCustomer = customersRepository.incrementUnreadCount(customer.id);
      const io = req.app.get('io');
      io.to(`user:${customer.assigned_agent_id}`).emit('conversation:new-message', {
        conversationId: customer.id,
        customerId: customer.id,
        message: {
          id: savedMessage.id,
          direction: savedMessage.direction,
          message: savedMessage.message,
          attachment_type: savedMessage.attachment_type,
          attachment_filename: savedMessage.attachment_filename,
          created_at: savedMessage.created_at,
        },
        timestamp: savedMessage.created_at,
        unreadCount: updatedCustomer.unread_count,
      });
    }
  } catch (err) {
    // لا نُعيد الخطأ للعميل (تم الرد 200 مسبقاً)؛ فقط نسجّله للمراجعة
    logSafeError('[webhookController] error processing incoming message:', err);
  }
}

module.exports = { verifyWebhook, handleIncomingMessage };
