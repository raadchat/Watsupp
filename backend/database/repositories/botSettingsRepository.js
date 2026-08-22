// database/repositories/botSettingsRepository.js
// صف واحد فقط (id=1) لمحتوى سلوك البوت — رسالة الترحيب وصورتها حالياً.

const db = require('../db');

function get() {
  return db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() || null;
}

function save({ welcome_message, welcome_image_filename }) {
  const existing = get();
  const finalImage =
    welcome_image_filename !== undefined ? welcome_image_filename : existing ? existing.welcome_image_filename : null;

  db.prepare(
    `INSERT INTO bot_settings (id, welcome_message, welcome_image_filename, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       welcome_message = excluded.welcome_message,
       welcome_image_filename = excluded.welcome_image_filename,
       updated_at = datetime('now')`
  ).run(welcome_message || null, finalImage);

  return get();
}

module.exports = { get, save };
