// database/repositories/messagesRepository.js
// سجل كل رسالة واردة (inbound) من العميل أو صادرة (outbound) من البوت أو
// مدير/وكيل رد يدوياً (sent_by=اسم المستخدم عندها، NULL إن كانت من البوت).

const db = require('../db');

function create({
  customer_id,
  direction,
  message,
  status = 'received',
  whatsapp_message_id = null,
  sent_by = null,
  attachment_type = null,
  attachment_filename = null,
}) {
  const info = db
    .prepare(
      `INSERT INTO messages (customer_id, direction, message, status, whatsapp_message_id, sent_by, attachment_type, attachment_filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(customer_id, direction, message, status, whatsapp_message_id, sent_by, attachment_type, attachment_filename);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
}

/** الأقدم أولاً (ترتيب محادثة طبيعي للعرض)، على عكس findRecent أدناه. */
function findByCustomerId(customerId, limit = 200) {
  return db
    .prepare('SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(customerId, limit);
}

module.exports = { create, findByCustomerId };
