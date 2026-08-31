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
const fs = require('fs');
const path = require('path');
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
/**
 * إرسال رسالة أزرار سريعة (Reply Buttons) — تدعم واتساب حداً أقصى 3 أزرار
 * لكل رسالة (على عكس القوائم التي تصل حتى 10). تُستخدم لأسئلة نعم/لا
 * البسيطة (مثل الموافقة على الإشعارات)، أو مع imageUrl لرسالة ترحيب تجمع
 * صورة + نص + زر تفاعلي واحد كما تدعمه واجهة واتساب فعلياً (header من نوع
 * image + body + action.buttons في نفس الرسالة).
 * @param {string} to
 * @param {string} bodyText
 * @param {Array<{id: string, title: string}>} buttons - 3 كحد أقصى، العنوان 20 حرفاً كحد أقصى
 * @param {string|null} imageUrl - رابط صورة عام اختياري تُعرض كـ header فوق النص والأزرار
 */
/**
 * رفع ملف إلى مساحة وسائط واتساب (POST /PHONE_NUMBER_ID/media) والحصول على
 * Media ID قابل لإعادة الاستخدام لعدة رسائل/عملاء (المرحلة 2 — النمط
 * المفضَّل بدل رابط عام: يعمل محلياً بلا حاجة لنطاق علني أو نفق مثل ngrok).
 * يستخدم fetch/FormData المدمجتين في Node (لا حزمة form-data إضافية).
 * @param {string} filePath - مسار الملف الفعلي على القرص
 * @param {string} mimeType
 * @returns {Promise<{success: boolean, mediaId?: string, error?: string}>}
 */
async function uploadMedia(filePath, mimeType) {
  const settings = whatsappSettingsRepository.get();
  if (!settings?.phone_number_id || !settings?.access_token) {
    console.error('[whatsappService] uploadMedia failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([fileBuffer], { type: mimeType }), path.basename(filePath));

    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${settings.phone_number_id}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.access_token}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.id) {
      const error = data?.error?.message || `فشل رفع الملف إلى واتساب (HTTP ${response.status})`;
      console.error('[whatsappService] uploadMedia failed:', error);
      return { success: false, error };
    }
    return { success: true, mediaId: data.id };
  } catch (err) {
    console.error('[whatsappService] uploadMedia failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * إرسال صورة/فيديو/مستند عبر Media ID مرفوع مسبقاً بـ uploadMedia() —
 * دالة مركزية واحدة (Generic Media Sender) بدل ثلاث دوال منفصلة، لأن الفرق
 * الوحيد بين الأنواع الثلاثة هو اسم الحقل وإمكانية إضافة filename للمستند.
 * @param {string} to
 * @param {{type: 'image'|'video'|'document', mediaId: string, caption?: string, filename?: string}} attachment
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendMediaMessage(to, { type, mediaId, caption, filename }) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendMediaMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const mediaPayload = { id: mediaId };
  if (caption) mediaPayload.caption = caption;
  if (type === 'document' && filename) mediaPayload.filename = filename;

  try {
    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type,
      [type]: mediaPayload,
    });
    return { success: true, messageId: extractMessageId(response) };
  } catch (err) {
    const error = extractApiError(err);
    console.error('[whatsappService] sendMediaMessage failed:', error);
    return { success: false, error };
  }
}

async function sendButtonMessage(to, bodyText, buttons, imageUrl = null) {
  const settings = whatsappSettingsRepository.get();
  const client = settings && buildClient(settings.phone_number_id, settings.access_token);
  if (!client) {
    console.error('[whatsappService] sendButtonMessage failed:', NOT_CONFIGURED_ERROR);
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const interactive = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    };
    if (imageUrl) {
      interactive.header = { type: 'image', image: { link: imageUrl } };
    }

    const response = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
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
  uploadMedia,
  sendMediaMessage,
  testConnection,
};
