// database/repositories/systemSettingsRepository.js
// قيم بنيوية للنظام نفسه (وليست "سلوك بوت" كباقي جداول الإعدادات) — حالياً
// jwt_secret فقط (المرحلة 3: AUTO_GENERATED). db.js يضمن وجود قيمة مولَّدة
// في قاعدة البيانات من أول إقلاع (ensureSystemSettingsMigration)؛ هذا الملف
// فقط يحسم أيهما يُستخدَم فعلياً وقت التشغيل، ولا يُصدِّر القيمة لأي مكان
// آخر غير هذه الدالة نفسها — لا توجد لهذا الملف أي طريقة GET عبر API.

const db = require('../db');

let cachedJwtSecret = null;

/**
 * القيمة الفعلية المستخدَمة لتوقيع/التحقق من JWT — .env صراحةً له الأولوية
 * دائماً إن ضُبط (يسمح بتثبيت نفس السرّ عبر عدة نسخ من الخادم مثلاً)، وإلا
 * القيمة المولَّدة تلقائياً والمخزَّنة في قاعدة البيانات. تُخزَّن نتيجة أول
 * استدعاء في الذاكرة (cache) لتفادي استعلام قاعدة بيانات مع كل طلب مصادقة.
 */
function getJwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;

  if (process.env.JWT_SECRET) {
    cachedJwtSecret = process.env.JWT_SECRET;
    return cachedJwtSecret;
  }

  const row = db.prepare('SELECT jwt_secret FROM system_settings WHERE id = 1').get();
  if (!row?.jwt_secret) {
    // لا يُفترض الوصول لهذا السطر عملياً — db.js يضمن القيمة عند كل إقلاع
    // (ensureSystemSettingsMigration) — لكن نتعامل معه بخطأ واضح بدل صمت غامض
    throw new Error('لم يُعثر على JWT secret، لا في .env ولا في قاعدة البيانات');
  }
  cachedJwtSecret = row.jwt_secret;
  return cachedJwtSecret;
}

module.exports = { getJwtSecret };
