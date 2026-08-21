// database/repositories/messagesRepository.js
// سجل كل رسالة واردة (inbound) من العميل أو صادرة (outbound) من البوت.

const db = require('../db');

function create({ customer_id, direction, message, status = 'received', whatsapp_message_id = null }) {
  const info = db
    .prepare(
      `INSERT INTO messages (customer_id, direction, message, status, whatsapp_message_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(customer_id, direction, message, status, whatsapp_message_id);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
}

function findByCustomerId(customerId, limit = 50) {
  return db
    .prepare('SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(customerId, limit);
}

module.exports = { create, findByCustomerId };
