// database/repositories/categoriesRepository.js
// جدول "المستوى الأول" في قائمة واتساب. findActive() هنا هي أول استعلام
// ينفَّذه conversationService عندما يكتب العميل "الخدمات" — بالضبط بنفس
// مبدأ servicesRepository.findActive() الأصلي، لكن للأقسام بدل الخدمات.

const db = require('../db');

function findAll() {
  return db.prepare('SELECT * FROM categories ORDER BY display_order ASC, created_at ASC').all();
}

function findActive() {
  return db
    .prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY display_order ASC, created_at ASC")
    .all();
}

function findById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function findByCategoryId(categoryId) {
  // categoryId هنا هو المعرف النصي (category_id) القادم من list_reply.id في واتساب،
  // وليس المفتاح الرقمي الداخلي (id) — نفس تمييز service_id عن id في servicesRepository
  return db.prepare('SELECT * FROM categories WHERE category_id = ?').get(categoryId);
}

function create({ category_id, name, description, display_order, status }) {
  const info = db
    .prepare(
      `INSERT INTO categories (category_id, name, description, display_order, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(category_id, name, description || null, display_order || 0, status || 'active');
  return findById(info.lastInsertRowid);
}

function update(id, { name, description, display_order, status }) {
  db.prepare(
    `UPDATE categories
     SET name = ?, description = ?, display_order = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, description || null, display_order || 0, status, id);
  return findById(id);
}

function remove(id) {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return info.changes > 0;
}

/** يُستخدم قبل الحذف لمنع حذف قسم لا تزال خدمات تشير إليه (بدل ترك خطأ FK خام يصل للمستخدم) */
function countLinkedServices(id) {
  return db.prepare('SELECT COUNT(*) AS count FROM services WHERE category_id = ?').get(id).count;
}

module.exports = {
  findAll,
  findActive,
  findById,
  findByCategoryId,
  create,
  update,
  remove,
  countLinkedServices,
};
