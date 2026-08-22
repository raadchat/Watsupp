// database/repositories/categoriesRepository.js
// جدول الأقسام، بدعم تداخل بلا حد للعمق عبر parent_category_id (NULL = قسم
// رئيسي). findActiveChildrenOf(null) هي أول استعلام ينفَّذه conversationService
// عندما يكتب العميل "الخدمات"؛ اختيار قسم له أبناء نشطون يستدعيها مجدداً
// بمعرّفه هو، فينزل مستوى إضافياً — بلا حد مبرمَج على العمق.

const db = require('../db');

function findAll() {
  return db
    .prepare(
      `SELECT categories.*, parent.name AS parent_name
       FROM categories
       LEFT JOIN categories AS parent ON parent.id = categories.parent_category_id
       ORDER BY categories.display_order ASC, categories.created_at ASC`
    )
    .all();
}

function findActive() {
  return db
    .prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY display_order ASC, created_at ASC")
    .all();
}

/** أبناء قسم مُعيَّن (أو الأقسام الرئيسية إن مُرِّر null) — النشطون فقط، للبوت. */
function findActiveChildrenOf(parentId) {
  if (parentId === null || parentId === undefined) {
    return db
      .prepare(
        "SELECT * FROM categories WHERE parent_category_id IS NULL AND status = 'active' ORDER BY display_order ASC, created_at ASC"
      )
      .all();
  }
  return db
    .prepare(
      "SELECT * FROM categories WHERE parent_category_id = ? AND status = 'active' ORDER BY display_order ASC, created_at ASC"
    )
    .all(parentId);
}

/** كل أبناء قسم (نشط أو لا) — للوحة التحكم عند بناء قائمة "القسم الأب" المنسدلة. */
function findAllChildrenOf(parentId) {
  if (parentId === null || parentId === undefined) {
    return db
      .prepare('SELECT * FROM categories WHERE parent_category_id IS NULL ORDER BY display_order ASC')
      .all();
  }
  return db
    .prepare('SELECT * FROM categories WHERE parent_category_id = ? ORDER BY display_order ASC')
    .all(parentId);
}

function hasActiveChildren(id) {
  return findActiveChildrenOf(id).length > 0;
}

function findById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function findByCategoryId(categoryId) {
  // categoryId هنا هو المعرف النصي (category_id) القادم من list_reply.id في واتساب،
  // وليس المفتاح الرقمي الداخلي (id) — نفس تمييز service_id عن id في servicesRepository
  return db.prepare('SELECT * FROM categories WHERE category_id = ?').get(categoryId);
}

/**
 * يتحقق أن اختيار parentId كأبٍ لـ categoryId لا يُنشئ حلقة (قسم يصبح
 * سلفاً لنفسه عبر سلسلة آباء). يمشي لأعلى من parentId فيرفض إن صادف
 * categoryId في الطريق. categoryId=null (إنشاء جديد) لا يمكن أن يُنشئ حلقة أبداً.
 */
function wouldCreateCycle(categoryId, parentId) {
  if (!parentId) return false;
  if (categoryId && Number(parentId) === Number(categoryId)) return true;

  let current = findById(parentId);
  const visited = new Set();
  while (current && current.parent_category_id) {
    if (visited.has(current.id)) return true; // حلقة موجودة أصلاً بشكل غير متوقع — توقف بأمان
    visited.add(current.id);
    if (categoryId && Number(current.parent_category_id) === Number(categoryId)) return true;
    current = findById(current.parent_category_id);
  }
  return false;
}

function create({ category_id, name, description, display_order, status, parent_category_id }) {
  const info = db
    .prepare(
      `INSERT INTO categories (category_id, name, description, display_order, status, parent_category_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(category_id, name, description || null, display_order || 0, status || 'active', parent_category_id || null);
  return findById(info.lastInsertRowid);
}

function update(id, { name, description, display_order, status, parent_category_id }) {
  db.prepare(
    `UPDATE categories
     SET name = ?, description = ?, display_order = ?, status = ?, parent_category_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, description || null, display_order || 0, status, parent_category_id || null, id);
  return findById(id);
}

function remove(id) {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return info.changes > 0;
}

/** يُستخدم قبل الحذف لمنع حذف قسم لا تزال خدمات أو أقسام فرعية تشير إليه. */
function countLinkedServices(id) {
  return db.prepare('SELECT COUNT(*) AS count FROM services WHERE category_id = ?').get(id).count;
}

function countChildren(id) {
  return db.prepare('SELECT COUNT(*) AS count FROM categories WHERE parent_category_id = ?').get(id).count;
}

module.exports = {
  findAll,
  findActive,
  findActiveChildrenOf,
  findAllChildrenOf,
  hasActiveChildren,
  findById,
  findByCategoryId,
  wouldCreateCycle,
  create,
  update,
  remove,
  countLinkedServices,
  countChildren,
};
