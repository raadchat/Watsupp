// database/repositories/customerServiceSessionsRepository.js
// المرحلة 8 — سجل عميل لكل جلسة خدمة عملاء كاملة، مستقل عن customers نفسه
// (الذي يعكس آخر حالة فقط). كل الاستعلامات هنا تعتمد "آخر صف بالحالة
// المتوقَّعة لهذا العميل" لأن التدفق الحالي لا يسمح بأكثر من جلسة waiting
// أو active واحدة في آنٍ واحد لنفس العميل (conversationService يتجاهل أي
// تفاعل بوت جديد أثناء وجوده في إحدى هاتين الحالتين) — فلا غموض عملياً.

const db = require('../db');

/** تُستدعى عند دخول العميل الطابور (اختيار خدمة العملاء من القائمة). */
function create(customerId) {
  db.prepare(`INSERT INTO customer_service_sessions (customer_id, queued_at, status) VALUES (?, datetime('now'), 'waiting')`).run(
    customerId
  );
}

/** تُستدعى عند claim — تُحدِّث آخر جلسة "waiting" لهذا العميل تحديداً. */
function markClaimed(customerId, agentId) {
  db.prepare(
    `UPDATE customer_service_sessions SET agent_id = ?, claimed_at = datetime('now'), status = 'active'
     WHERE id = (
       SELECT id FROM customer_service_sessions WHERE customer_id = ? AND status = 'waiting' ORDER BY queued_at DESC LIMIT 1
     )`
  ).run(agentId, customerId);
}

/** تُستدعى عند end — تُحدِّث آخر جلسة "active" لهذا العميل تحديداً. */
function markEnded(customerId) {
  db.prepare(
    `UPDATE customer_service_sessions SET ended_at = datetime('now'), status = 'completed'
     WHERE id = (
       SELECT id FROM customer_service_sessions WHERE customer_id = ? AND status = 'active' ORDER BY claimed_at DESC LIMIT 1
     )`
  ).run(customerId);
}

/** تُستدعى عند وصول رد التقييم — آخر جلسة منتهية بلا تقييم بعد لهذا العميل. */
function setRating(customerId, rating) {
  db.prepare(
    `UPDATE customer_service_sessions SET rating = ?
     WHERE id = (
       SELECT id FROM customer_service_sessions
       WHERE customer_id = ? AND status = 'completed' AND rating IS NULL
       ORDER BY ended_at DESC LIMIT 1
     )`
  ).run(rating, customerId);
}

/**
 * سجل عميل وكيل معيَّن — رقم العميل، الأوقات، مدة الانتظار، التقييم، وعدد
 * الرسائل الفعلي المتبادَل خلال هذه الجلسة تحديداً (يُحسَب من messages
 * مباشرة، لا عمود مكرَّر يمكن أن يختلّ تزامنه).
 */
function findByAgentId(agentId) {
  return db
    .prepare(
      `SELECT
         s.id, s.customer_id, c.phone_number, s.queued_at, s.claimed_at, s.ended_at, s.rating, s.status,
         (
           SELECT COUNT(*) FROM messages m
           WHERE m.customer_id = s.customer_id
             AND m.created_at >= s.queued_at
             AND m.created_at <= COALESCE(s.ended_at, datetime('now'))
         ) AS message_count
       FROM customer_service_sessions s
       JOIN customers c ON c.id = s.customer_id
       WHERE s.agent_id = ?
       ORDER BY s.queued_at DESC`
    )
    .all(agentId);
}

module.exports = { create, markClaimed, markEnded, setRating, findByAgentId };
