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

/** يُضيف تقييماً جديداً (1-5 نجوم) لرصيد وكيل — المتوسط يُحسَب لاحقاً من rating_total/rating_count عند العرض. */
function addRating(agentId, stars) {
  db.prepare(
    `UPDATE admins SET rating_total = rating_total + ?, rating_count = rating_count + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(stars, agentId);
  return findById(agentId);
}

module.exports = { findByUsername, findById, create, count, findAllAgents, addRating };
