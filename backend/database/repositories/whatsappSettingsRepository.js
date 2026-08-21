// database/repositories/whatsappSettingsRepository.js
// صف واحد فقط (id=1) لبيانات اتصال WhatsApp القابلة للتعديل من لوحة التحكم.
//
// تراجع متوافق مع الإصدار السابق: إن لم يُحفظ أي شيء بعد من اللوحة، get()
// يتراجع تلقائياً لقيم WHATSAPP_* في .env (إن وُجدت) حتى لا ينكسر تشغيل
// من كان يستخدم .env قبل إضافة هذه الميزة. أول حفظ أو اختبار ناجح من
// اللوحة يُنشئ صفاً حقيقياً في القاعدة، فتصبح هي المصدر النهائي بعدها.

const db = require('../db');

function get() {
  const row = db.prepare('SELECT * FROM whatsapp_settings WHERE id = 1').get();
  if (row && (row.access_token || row.phone_number_id)) {
    return { ...row, _source: 'db' };
  }

  if (process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      id: 1,
      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
      access_token: process.env.WHATSAPP_ACCESS_TOKEN || null,
      verify_token: process.env.WHATSAPP_VERIFY_TOKEN || null,
      business_account_id: null,
      status: 'disconnected', // لم يُختبر بعد عبر هذا المسار حتى لو كان يعمل سابقاً
      last_tested_at: null,
      last_test_result: null,
      _source: 'env',
    };
  }

  return null;
}

/**
 * حفظ (upsert) — إن جاء access_token فارغاً/محذوفاً، يُبقي على القيمة
 * المحفوظة سابقاً بدل مسحها (حتى لا يُضطر المدير لإعادة لصق التوكن في
 * كل مرة يعدّل فيها حقلاً آخر فقط).
 */
function save({ phone_number_id, access_token, verify_token, business_account_id }) {
  const existing = db.prepare('SELECT * FROM whatsapp_settings WHERE id = 1').get();
  const finalAccessToken = access_token || (existing ? existing.access_token : null);

  db.prepare(
    `INSERT INTO whatsapp_settings (id, phone_number_id, access_token, verify_token, business_account_id, updated_at)
     VALUES (1, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       phone_number_id = excluded.phone_number_id,
       access_token = excluded.access_token,
       verify_token = excluded.verify_token,
       business_account_id = excluded.business_account_id,
       updated_at = datetime('now')`
  ).run(phone_number_id || null, finalAccessToken, verify_token || null, business_account_id || null);

  return { ...db.prepare('SELECT * FROM whatsapp_settings WHERE id = 1').get(), _source: 'db' };
}

function updateTestResult(status, message) {
  db.prepare(
    `UPDATE whatsapp_settings SET status = ?, last_tested_at = datetime('now'), last_test_result = ? WHERE id = 1`
  ).run(status, message);
}

module.exports = { get, save, updateTestResult };
