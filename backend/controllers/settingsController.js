// controllers/settingsController.js
// يدير صفحة "الاتصال بواتساب" في اللوحة: عرض الحالة الحالية، حفظ بيانات
// اتصال جديدة مع اختبارها فوراً بطلب حقيقي لـ Meta، أو إعادة اختبار ما
// هو محفوظ بالفعل دون إعادة إدخال أي شيء.

const crypto = require('crypto');
const whatsappSettingsRepository = require('../database/repositories/whatsappSettingsRepository');
const whatsappService = require('../services/whatsappService');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

/** لا يُعاد access_token كاملاً أبداً في أي استجابة — فقط تلميح بآخر 4 خانات. */
function maskSettings(settings) {
  if (!settings) return null;
  return {
    phone_number_id: settings.phone_number_id || null,
    verify_token: settings.verify_token || null,
    business_account_id: settings.business_account_id || null,
    has_access_token: Boolean(settings.access_token),
    access_token_preview: settings.access_token ? `••••••••${settings.access_token.slice(-4)}` : null,
    status: settings.status,
    last_tested_at: settings.last_tested_at,
    last_test_result: settings.last_test_result,
    source: settings._source, // 'db' أو 'env' — للوحة فقط، ليست بياناً حساساً
  };
}

/** يحفظ البيانات المُمرَّرة فوراً، ثم يختبرها حقاً، ثم يسجّل نتيجة الاختبار — عملية واحدة مترابطة. */
async function persistAndTest({ phone_number_id, access_token, verify_token, business_account_id }) {
  const saved = whatsappSettingsRepository.save({ phone_number_id, access_token, verify_token, business_account_id });

  const testResult = await whatsappService.testConnection({
    phone_number_id: saved.phone_number_id,
    access_token: saved.access_token,
  });

  const message = testResult.success
    ? `متصل — ${testResult.details.display_phone_number || saved.phone_number_id}${testResult.details.verified_name ? ` (${testResult.details.verified_name})` : ''}`
    : testResult.error;

  whatsappSettingsRepository.updateTestResult(testResult.success ? 'connected' : 'disconnected', message);

  return { saved: whatsappSettingsRepository.get(), testResult };
}

const getWhatsAppSettings = asyncHandler(async (req, res) => {
  const current = whatsappSettingsRepository.get();
  const data = maskSettings(current) || {};

  // اقتراح verify_token جاهز عند أول فتح للصفحة إن لم يوجد واحد بعد،
  // حتى لا يُضطر المدير لاختراع نص عشوائي بنفسه — لا يُحفظ إلا عند الحفظ الفعلي
  if (!data.verify_token) {
    data.verify_token = crypto.randomBytes(16).toString('hex');
    data.verify_token_suggested = true;
  }

  res.json({ success: true, data });
});

const saveWhatsAppSettings = asyncHandler(async (req, res) => {
  const { phone_number_id, access_token, verify_token, business_account_id } = req.body;

  if (!phone_number_id) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'معرّف رقم الهاتف (Phone Number ID) مطلوب', 400);
  }
  if (!verify_token) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Verify Token مطلوب', 400);
  }

  const { saved, testResult } = await persistAndTest({ phone_number_id, access_token, verify_token, business_account_id });
  res.json({ success: true, data: { settings: maskSettings(saved), test: testResult } });
});

const retestWhatsAppConnection = asyncHandler(async (req, res) => {
  const current = whatsappSettingsRepository.get();
  if (!current || !current.access_token || !current.phone_number_id) {
    throw new AppError(ErrorCodes.WHATSAPP_NOT_CONFIGURED, 'لم يتم إعداد اتصال واتساب بعد', 400);
  }

  // إعادة الحفظ هنا (بنفس القيم) تُثبّت تلقائياً أي إعداد قادم من .env في
  // قاعدة البيانات كصف حقيقي أول مرة يُعاد فيها الاختبار (ترحيل ذاتي شفاف)
  const { saved, testResult } = await persistAndTest(current);
  res.json({ success: true, data: { settings: maskSettings(saved), test: testResult } });
});

module.exports = { getWhatsAppSettings, saveWhatsAppSettings, retestWhatsAppConnection };
