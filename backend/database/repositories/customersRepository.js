// database/repositories/customersRepository.js

const db = require('../db');

function findAll({ search, page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;

  let rows;
  let total;

  if (search) {
    const like = `%${search}%`;
    rows = db
      .prepare(
        `SELECT * FROM customers WHERE phone_number LIKE ?
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(like, safePageSize, offset);
    total = db
      .prepare('SELECT COUNT(*) AS count FROM customers WHERE phone_number LIKE ?')
      .get(like).count;
  } else {
    rows = db
      .prepare('SELECT * FROM customers ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(safePageSize, offset);
    total = db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
  }

  return { rows, total, page: safePage, pageSize: safePageSize };
}

function findById(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function findByPhone(phoneNumber) {
  return db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(phoneNumber);
}

function create({ phone_number, conversation_state = 'MAIN_MENU' }) {
  const info = db
    .prepare(
      `INSERT INTO customers (phone_number, conversation_state, last_contact)
       VALUES (?, ?, datetime('now'))`
    )
    .run(phone_number, conversation_state);
  return findById(info.lastInsertRowid);
}

function updateState(id, conversationState, lastSelectedServiceId) {
  if (lastSelectedServiceId !== undefined) {
    db.prepare(
      `UPDATE customers
       SET conversation_state = ?, last_selected_service_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(conversationState, lastSelectedServiceId, id);
  } else {
    db.prepare(
      `UPDATE customers SET conversation_state = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(conversationState, id);
  }
  return findById(id);
}

function updateLastContact(id) {
  db.prepare(
    `UPDATE customers SET last_contact = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);
}

function updateNotificationOptIn(id, optIn) {
  db.prepare(
    `UPDATE customers SET notifications_opt_in = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(optIn, id);
  return findById(id);
}

/**
 * يحفظ مسار التنقّل الحالي في قوائم واتساب (المرحلة 1 — الرجوع)، كمصفوفة
 * من معرّفات الأقسام الرقمية من الجذر حتى الموضع الحالي — []  يعني الجذر.
 * لا يُحدَّث updated_at عمداً هنا (هذا تفصيل تنقّل داخلي، وليس نشاطاً فعلياً
 * للعميل يستحق التأثير على ترتيب القوائم/الطوابير التي تعتمد على updated_at).
 */
function updateNavigationStack(id, stack) {
  db.prepare('UPDATE customers SET navigation_stack = ? WHERE id = ?').run(
    JSON.stringify(Array.isArray(stack) ? stack : []),
    id
  );
}

function countOptedIn() {
  return db.prepare("SELECT COUNT(*) AS count FROM customers WHERE notifications_opt_in = 'opted_in'").get().count;
}

/** المرحلة 9: رسالة واردة جديدة أثناء محادثة نشطة — تُستدعى من webhookController فقط. */
function incrementUnreadCount(id) {
  db.prepare('UPDATE customers SET unread_count = unread_count + 1 WHERE id = ?').run(id);
  return findById(id);
}

/** المرحلة 9: يُستدعى عند فتح محادثة هذا العميل تحديداً — لا يمسّ عملاء آخرين. */
function resetUnreadCount(id) {
  db.prepare('UPDATE customers SET unread_count = 0 WHERE id = ?').run(id);
}

/** أرقام هواتف العملاء الموافقين على تلقي الإشعارات — تُستخدم كمصدر أرقام مباشر في الإرسال الجماعي. */
function findOptedInPhoneNumbers() {
  return db
    .prepare("SELECT phone_number FROM customers WHERE notifications_opt_in = 'opted_in'")
    .all()
    .map((r) => r.phone_number);
}

/** طابور خدمة العملاء: من ينتظر وكيلاً بعد، مرتَّبين الأقدم أولاً (عدالة الدور). */
function findWaitingForAgent() {
  return db
    .prepare(
      `SELECT * FROM customers WHERE conversation_state = 'CUSTOMER_SERVICE_WAITING' ORDER BY updated_at ASC`
    )
    .all();
}

/** محادثات خدمة العملاء المُسندة حالياً لوكيل مُعيَّن (نشطة الآن، وليس الطابور العام). */
function findActiveByAgent(agentId) {
  return db
    .prepare(
      `SELECT * FROM customers
       WHERE assigned_agent_id = ? AND conversation_state = 'CUSTOMER_SERVICE_ACTIVE'
       ORDER BY updated_at ASC`
    )
    .all(agentId);
}

function assignAgent(customerId, agentId, newState) {
  db.prepare(
    `UPDATE customers SET assigned_agent_id = ?, conversation_state = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(agentId, newState, customerId);
  return findById(customerId);
}

module.exports = {
  findAll,
  findById,
  findByPhone,
  create,
  updateState,
  updateLastContact,
  updateNotificationOptIn,
  updateNavigationStack,
  countOptedIn,
  findOptedInPhoneNumbers,
  findWaitingForAgent,
  findActiveByAgent,
  assignAgent,
  incrementUnreadCount,
  resetUnreadCount,
};
