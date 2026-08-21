// database/repositories/adminsRepository.js
// كل الوصول لجدول admins يمر من هنا فقط (Parameterized Queries عبر node:sqlite
// لمنع SQL Injection بشكل كامل — لا يوجد أي تجميع نصوص يدوي للـ SQL في المشروع).

const db = require('../db');

function findByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
}

function findById(id) {
  // لا نُعيد password_hash عند القراءة العامة بالـ id
  return db
    .prepare('SELECT id, username, role, created_at, updated_at FROM admins WHERE id = ?')
    .get(id);
}

function create({ username, password_hash, role = 'admin' }) {
  const info = db
    .prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, password_hash, role);
  return findById(info.lastInsertRowid);
}

function count() {
  return db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
}

module.exports = { findByUsername, findById, create, count };
