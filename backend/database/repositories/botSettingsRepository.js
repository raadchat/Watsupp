// database/repositories/botSettingsRepository.js
// صف واحد فقط (id=1) لمحتوى سلوك البوت — رسالة الترحيب وصورتها، والرابط
// العام للخادم (public_base_url) اللازم لبناء رابط صورة الترحيب الذي يجلبه
// واتساب فعلياً. get() يتراجع لـ PUBLIC_BASE_URL من .env إن لم يُحفظ شيء
// من اللوحة بعد — نفس نمط whatsappSettingsRepository.

const db = require('../db');

function get() {
  const row = db.prepare('SELECT * FROM bot_settings WHERE id = 1').get();
  if (row) {
    return { ...row, public_base_url: row.public_base_url || process.env.PUBLIC_BASE_URL || null };
  }
  if (process.env.PUBLIC_BASE_URL) {
    return {
      id: 1,
      welcome_message: null,
      welcome_image_filename: null,
      welcome_image_media_id: null,
      public_base_url: process.env.PUBLIC_BASE_URL,
      show_customer_phone_to_agents: 1,
      updated_at: null,
    };
  }
  return null;
}

function save({ welcome_message, welcome_image_filename, public_base_url, welcome_image_media_id, show_customer_phone_to_agents }) {
  const existing = db.prepare('SELECT * FROM bot_settings WHERE id = 1').get();
  const finalImage =
    welcome_image_filename !== undefined ? welcome_image_filename : existing ? existing.welcome_image_filename : null;
  const finalBaseUrl =
    public_base_url !== undefined ? public_base_url : existing ? existing.public_base_url : null;
  // إن تغيّرت الصورة (رفع/حذف) بلا تمرير media_id صريح، لا نُبقي media_id قديماً
  // يشير لملف لم يعد موجوداً — نُصفّره ليُعاد رفعه لاحقاً عند أول إرسال فعلي
  const finalMediaId =
    welcome_image_media_id !== undefined
      ? welcome_image_media_id
      : welcome_image_filename !== undefined
        ? null
        : existing
          ? existing.welcome_image_media_id
          : null;
  // المرحلة 7: افتراضي 1 (ظاهر) لو لم يُحدَّد بعد — يحافظ على السلوك الحالي
  // كما هو حتى يختار المدير صراحةً إخفاءه
  const finalShowPhone =
    show_customer_phone_to_agents !== undefined
      ? (show_customer_phone_to_agents ? 1 : 0)
      : existing
        ? existing.show_customer_phone_to_agents
        : 1;

  db.prepare(
    `INSERT INTO bot_settings (id, welcome_message, welcome_image_filename, public_base_url, welcome_image_media_id, show_customer_phone_to_agents, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       welcome_message = excluded.welcome_message,
       welcome_image_filename = excluded.welcome_image_filename,
       public_base_url = excluded.public_base_url,
       welcome_image_media_id = excluded.welcome_image_media_id,
       show_customer_phone_to_agents = excluded.show_customer_phone_to_agents,
       updated_at = datetime('now')`
  ).run(welcome_message || null, finalImage, finalBaseUrl || null, finalMediaId, finalShowPhone);

  return get();
}

module.exports = { get, save };
