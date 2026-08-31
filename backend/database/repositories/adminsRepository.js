// database/repositories/adminsRepository.js
// كل الوصول لجدول admins يمر من هنا فقط (Parameterized Queries عبر node:sqlite
// لمنع SQL Injection بشكل كامل — لا يوجد أي تجميع نصوص يدوي للـ SQL في المشروع).
// role: 'admin' (لوحة تحكم كاملة) أو 'agent' (وكيل خدمة عملاء، واجهة مبسّطة فقط).
// name هو الاسم المعروض (يظهر للعميل عند تولّي وكيل محادثته)، مختلف عن
// username المُستخدَم لتسجيل الدخول فقط.

const db = require('../db');

const SAFE_COLUMNS = 'id, username, name, role, rating_total, rating_count, created_at, updated_at';

function findByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
}

function findById(id) {
  // لا نُعيد password_hash عند القراءة العامة بالـ id
  return db.prepare(`SELECT ${SAFE_COLUMNS} FROM admins WHERE id = ?`).get(id);
}

function create({ username, password_hash, role = 'admin', name }) {
  const info = db
    .prepare('INSERT INTO admins (username, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(username, password_hash, role, name || username);
  return findById(info.lastInsertRowid);
}

function count() {
  return db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
}

/** كل وكلاء خدمة العملاء (role='agent') لصفحة "المستخدمون" — بلا password_hash أبداً. */
function findAllAgents() {
  return db.prepare(`SELECT ${SAFE_COLUMNS} FROM admins WHERE role = 'agent' ORDER BY created_at ASC`).all();
}

/** كل المستخدمين (admin وagent معاً، المرحلة 6) — بلا password_hash أبداً. */
function findAll() {
  return db.prepare(`SELECT ${SAFE_COLUMNS} FROM admins ORDER BY role ASC, created_at ASC`).all();
}

/** عدد المستخدمين بدور معيَّن — يُستخدَم لمنع حذف/تخفيض آخر admin في النظام. */
function countByRole(role) {
  return db.prepare('SELECT COUNT(*) AS count FROM admins WHERE role = ?').get(role).count;
}

/** تعديل الاسم و/أو نوع الحساب (المرحلة 6) — لا يلمس username ولا password_hash إطلاقاً. */
function update(id, { name, role } = {}) {
  const existing = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!existing) return null;
  const finalName = name !== undefined ? name : existing.name;
  const finalRole = role !== undefined ? role : existing.role;
  db.prepare(`UPDATE admins SET name = ?, role = ?, updated_at = datetime('now') WHERE id = ?`).run(finalName, finalRole, id);
  return findById(id);
}

/**
 * حذف مستخدم (المرحلة 6). customers.assigned_agent_id وbulk_jobs.created_by
 * قيدا Foreign Key حقيقيان (PRAGMA foreign_keys=ON في db.js)، فيُصفَّران
 * أولاً لأي صفوف تشير لهذا المستخدم — وإلا فشل الحذف بخطأ SQLite خام بدل
 * رسالة واضحة. سجل الرسائل الفعلي (messages.sent_by) نص ثابت غير متأثر
 * إطلاقاً، فمحتوى المحادثات القديمة لا يُفقَد — فقط "من كان مُسنَداً له"
 * على صفوف عملاء/رسائل جماعية قديمة تحديداً.
 */
function remove(id) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE customers SET assigned_agent_id = NULL WHERE assigned_agent_id = ?').run(id);
    db.prepare('UPDATE bulk_jobs SET created_by = NULL WHERE created_by = ?').run(id);
    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** يُضيف تقييماً جديداً (1-5 نجوم) لرصيد وكيل — المتوسط يُحسَب لاحقاً من rating_total/rating_count عند العرض. */
function addRating(agentId, stars) {
  db.prepare(
    `UPDATE admins SET rating_total = rating_total + ?, rating_count = rating_count + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(stars, agentId);
  return findById(agentId);
}

/** يُستخدَم من سكربت الاسترجاع الطارئ (npm run reset-password) فقط — hash جاهز مسبقاً، لا كلمة مرور صريحة هنا أبداً. */
function updatePassword(id, password_hash) {
  db.prepare(`UPDATE admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(password_hash, id);
  return findById(id);
}

module.exports = {
  findByUsername,
  findById,
  create,
  count,
  findAllAgents,
  findAll,
  countByRole,
  update,
  remove,
  addRating,
  updatePassword,
};
