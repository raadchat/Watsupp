// database/repositories/agentLoginLogsRepository.js
// المرحلة 8 — سجل دخول/خروج لكل مستخدم. صف جديد عند كل تسجيل دخول ناجح؛
// logout_at يُملأ فقط عند تسجيل خروج صريح (راجع ملاحظة الجدول في schema.sql).

const db = require('../db');

function recordLogin(adminId) {
  db.prepare(`INSERT INTO agent_login_logs (admin_id, login_at) VALUES (?, datetime('now'))`).run(adminId);
}

/** يُغلق آخر صف مفتوح (logout_at IS NULL) لهذا المستخدم تحديداً — لا يلمس صفوفاً أقدم منتهية بالفعل. */
function recordLogout(adminId) {
  db.prepare(
    `UPDATE agent_login_logs SET logout_at = datetime('now')
     WHERE id = (
       SELECT id FROM agent_login_logs WHERE admin_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1
     )`
  ).run(adminId);
}

function findByAdminId(adminId) {
  return db.prepare('SELECT * FROM agent_login_logs WHERE admin_id = ? ORDER BY login_at DESC').all(adminId);
}

module.exports = { recordLogin, recordLogout, findByAdminId };
