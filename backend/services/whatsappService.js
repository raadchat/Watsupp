// services/whatsappService.js
// الطبقة الوحيدة في المشروع التي تتحدث مباشرة مع WhatsApp Cloud API (Meta).
// أي مكان آخر يريد إرسال رسالة يستدعي هذه الدوال، ولا يبني طلب HTTP بنفسه.
//
// افتراض تقني مذكور بوضوح: المواصفات لم تحدد أي مزوّد WhatsApp API، لكن أسماء
// متغيرات البيئة المطلوبة أصلاً (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_VERIFY_TOKEN) تطابق تحديداً WhatsApp Business Cloud API الرسمي من Meta،
// لذلك اعتُمد عليه هنا. المنطق الآخر (الطابور، حالة المحادثة، الـ webhook) لا
// يعرف تفاصيل هذا المزوّد، فتبديله لاحقاً بمزوّد آخر (مثل 360dialog) يعني تعديل
// هذا الملف فقط.
//
// تحديث: بيانات الاتصال (access_token/phone_number_id) لم تعد مقروءة مرة واحدة
// عند إقلاع الخادم فقط — تُقرأ من whatsappSettingsRepository في كل استدعاء،
// لأن المدير أصبح يستطيع حفظها/تغييرها من لوحة التحكم في أي وقت دون إعادة تشغيل.

const axios = require('axios');
const whatsappSettingsRepository = require('../database/repositories/whatsappSettingsRepository');

function extractMessageId(response) {
  return response?.data?.messages?.[0]?.id || null;
}

function extractApiError(err) {
  return err.response?.data?.error?.message || err.message || 'خطأ غير معروف في اتصال واتساب';
}

/** يبني عميل axios من أحدث بيانات اتصال محفوظة، أو null إن لم تُضبط بعد. */
function buildClient(phoneNumberId, accessToken) {
  if (!phoneNumberId || !accessToken) return null;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  return axios.create({
    baseURL: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

const NOT_CONFIGURED_ERROR =
  'لم يتم إعداد اتصال واتساب بعد — أضف بيانات الاتصال واختبرها من صفحة "الاتصال بواتساب" في اللوحة';

/**
 * إرسال رسالة نصية بسيطة. تقرأ بيانات الاتصال الحالية من الإعدادات مباشرة
 * (لوحة التحكم أو .env كتراجع)، وليس من عميل ثابت أُنشئ عند الإقلاع.
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendTextMessage(to, text) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendTextMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    });
    return { success: true, messageId: extractMessageId(response) };
  } catch (err) {
    const error = extractApiError(err);
    console.error('[whatsappService] sendTextMessage failed:', error);
    return { success: false, error };
  }
}

/**
 * إرسال رسالة قائمة تفاعلية (Interactive List Message).
 * @param {string} to
 * @param {{headerText?: string, bodyText: string, footerText?: string, buttonText: string, sections: Array}} content
 */
async function sendInteractiveListMessage(to, { headerText, bodyText, footerText, buttonText, sections }) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendInteractiveListMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const interactive = {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonText, sections },
    };
    if (headerText) interactive.header = { type: 'text', text: headerText };
    if (footerText) interactive.footer = { text: footerText };

    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
    });
    return { success: true, messageId: extractMessageId(response) };
  } catch (err) {
    const error = extractApiError(err);
    console.error('[whatsappService] sendInteractiveListMessage failed:', error);
    return { success: false, error };
  }
}

/**
 * اختبار اتصال حقيقي وبلا أثر جانبي: يستعلم عن بيانات رقم الهاتف نفسه من
 * Meta (بلا إرسال أي رسالة لأي عميل حقيقي). يقبل بيانات مُمرَّرة مباشرة
 * (مفيد لاختبار نموذج لم يُحفظ بعد) بدل الاعتماد فقط على ما هو محفوظ.
 * @returns {Promise<{success: boolean, details?: object, error?: string}>}
 */
async function testConnection({ phone_number_id, access_token }) {
  if (!phone_number_id || !access_token) {
    return { success: false, error: 'معرّف رقم الهاتف والتوكن مطلوبان للاختبار' };
  }

  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  try {
    const response = await axios.get(`https://graph.facebook.com/${apiVersion}/${phone_number_id}`, {
      params: { fields: 'verified_name,display_phone_number,quality_rating,code_verification_status' },
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 15000,
    });
    return {
      success: true,
      details: {
        display_phone_number: response.data.display_phone_number || null,
        verified_name: response.data.verified_name || null,
        quality_rating: response.data.quality_rating || null,
      },
    };
  } catch (err) {
    return { success: false, error: extractApiError(err) };
  }
}

/**
 * إرسال صورة (مع تعليق نصي اختياري) عبر رابط عام يستطيع خادم Meta الوصول
 * إليه — يُستخدم لرسالة الترحيب المُهيَّأة من لوحة التحكم. لن يعمل إن كان
 * imageUrl يشير إلى localhost (Meta لا يستطيع الوصول لجهازك)؛ يعمل بمجرد
 * نشر الخادم على نطاق حقيقي أو تشغيل نفق مثل ngrok أثناء التجربة.
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendImageMessage(to, imageUrl, caption) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendImageMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, caption: caption || undefined },
    });
    return { success: true, messageId: extractMessageId(response) };
  } catch (err) {
    const error = extractApiError(err);
    console.error('[whatsappService] sendImageMessage failed:', error);
    return { success: false, error };
  }
}

/**
 * إرسال رسالة أزرار سريعة (Reply Buttons) — تدعم واتساب حداً أقصى 3 أزرار
 * لكل رسالة (على عكس القوائم التي تصل حتى 10). تُستخدم لأسئلة نعم/لا
 * البسيطة (مثل الموافقة على الإشعارات) بدل قائمة تفاعلية كاملة.
 * @param {string} to
 * @param {string} bodyText
 * @param {Array<{id: string, title: string}>} buttons - 3 كحد أقصى، العنوان 20 حرفاً كحد أقصى
 */
async function sendButtonMessage(to, bodyText, buttons) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendButtonMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
    return { success: true, messageId: extractMessageId(response) };
  } catch (err) {
    const error = extractApiError(err);
    console.error('[whatsappService] sendButtonMessage failed:', error);
    return { success: false, error };
  }
}

module.exports = {
  sendTextMessage,
  sendInteractiveListMessage,
  sendImageMessage,
  sendButtonMessage,
  testConnection,
};
