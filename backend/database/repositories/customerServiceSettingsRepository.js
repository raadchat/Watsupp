// database/repositories/customerServiceSettingsRepository.js
// صف واحد فقط (id=1) يتحكم في القسم الثابت "خدمة العملاء" — تفعيله/إيقافه
// من لوحة التحكم، وتسميته المعروضة للعميل.

const db = require('../db');

function get() {
  const row = db.prepare('SELECT * FROM customer_service_settings WHERE id = 1').get();
  if (row) return row;
  return { id: 1, enabled: 0, label: 'خدمة العملاء', updated_at: null };
}

function save({ enabled, label }) {
  db.prepare(
    `INSERT INTO customer_service_settings (id, enabled, label, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, label = excluded.label, updated_at = datetime('now')`
  ).run(enabled ? 1 : 0, label || 'خدمة العملاء');
  return get();
}

module.exports = { get, save };
