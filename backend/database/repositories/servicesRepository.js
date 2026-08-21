// database/repositories/servicesRepository.js
// هذا الملف هو قلب "القائمة الديناميكية": findActive()/findActiveByCategoryId()
// هي نفس الدوال التي يستدعيها كل من GET /api/services (للوحة التحكم) و
// webhookController (للبوت). أي صف تُضيفه/تُعدّله/تحذفه من هنا يظهر فوراً
// للطرفين — لا توجد نسخة مخزّنة مؤقتاً (cache) ولا قائمة مكتوبة داخل الكود.
//
// category_id هنا عمود رقمي (مرجع إلى categories.id الداخلي)، مطابقاً لنفس
// اصطلاح customers.last_selected_service_id → services.id. القراءات تُلحق
// (JOIN) اسم القسم للعرض في اللوحة عبر category_name.

const db = require('../db');

const SELECT_WITH_CATEGORY = `
  SELECT services.*, categories.name AS category_name
  FROM services
  LEFT JOIN categories ON categories.id = services.category_id
`;

function findAll() {
  return db.prepare(`${SELECT_WITH_CATEGORY} ORDER BY services.created_at DESC`).all();
}

function findActive() {
  return db
    .prepare(`${SELECT_WITH_CATEGORY} WHERE services.status = 'active' ORDER BY services.created_at ASC`)
    .all();
}

/** خدمات قسم واحد فقط — المستوى الثاني من القائمة بعد اختيار العميل لقسم. */
function findActiveByCategoryId(categoryDbId) {
  return db
    .prepare(
      `${SELECT_WITH_CATEGORY}
       WHERE services.status = 'active' AND services.category_id = ?
       ORDER BY services.created_at ASC`
    )
    .all(categoryDbId);
}

function findById(id) {
  return db.prepare(`${SELECT_WITH_CATEGORY} WHERE services.id = ?`).get(id);
}

function findByServiceId(serviceId) {
  return db.prepare(`${SELECT_WITH_CATEGORY} WHERE services.service_id = ?`).get(serviceId);
}

function create({ service_id, name, description, category_id, status }) {
  const info = db
    .prepare(
      `INSERT INTO services (service_id, name, description, category_id, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(service_id, name, description || null, category_id || null, status || 'active');
  return findById(info.lastInsertRowid);
}

function update(id, { name, description, category_id, status }) {
  db.prepare(
    `UPDATE services
     SET name = ?, description = ?, category_id = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, description || null, category_id || null, status, id);
  return findById(id);
}

function remove(id) {
  const info = db.prepare('DELETE FROM services WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  findAll,
  findActive,
  findActiveByCategoryId,
  findById,
  findByServiceId,
  create,
  update,
  remove,
};
