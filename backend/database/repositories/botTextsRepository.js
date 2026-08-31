// database/repositories/botTextsRepository.js
// تخزين التخصيصات فقط (Overrides) — النصوص الافتراضية معرَّفة في
// backend/services/botTexts.js، وليس هنا. لا كاش هنا عمداً (نفس نمط باقي
// جداول الإعدادات في هذا المشروع) — كل قراءة تعكس آخر ما حُفظ فوراً.

const db = require('../db');

/** كل التخصيصات المحفوظة حالياً، كخريطة { key: value }. */
function getAll() {
  const rows = db.prepare('SELECT key, value FROM bot_texts').all();
  const map = {};
  rows.forEach((r) => {
    map[r.key] = r.value;
  });
  return map;
}

/**
 * entries: { key: value }. قيمة فارغة (بعد trim) أو null تحذف التخصيص
 * (فيرجع ذلك النص للافتراضي تلقائياً)، وإلا تُحفَظ (إنشاء أو تحديث). كل
 * المفاتيح تُطبَّق معاً ذرّياً (BEGIN/COMMIT/ROLLBACK يدوية — node:sqlite لا
 * يملك db.transaction() الجاهزة من better-sqlite3، نفس نمط bulkJobsRepository.js).
 */
function setMany(entries) {
  const upsert = db.prepare(
    `INSERT INTO bot_texts (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const del = db.prepare('DELETE FROM bot_texts WHERE key = ?');

  db.exec('BEGIN');
  try {
    Object.entries(entries).forEach(([key, value]) => {
      const trimmed = typeof value === 'string' ? value.trim() : value;
      if (!trimmed) {
        del.run(key);
      } else {
        upsert.run(key, trimmed);
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getAll();
}

module.exports = { getAll, setMany };
