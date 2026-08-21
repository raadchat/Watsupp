// database/repositories/bulkJobsRepository.js
// يدير جدولي bulk_jobs (الوظيفة ككل) و bulk_job_items (كل رقم على حدة داخل الوظيفة).
// هذه هي البيانات التي يقرأ/يكتب منها services/messageQueue.js أثناء المعالجة.

const db = require('../db');

function createJob({ message_text, numbers, created_by }) {
  const insertJob = db.prepare(
    `INSERT INTO bulk_jobs (message_text, total_count, created_by) VALUES (?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO bulk_job_items (job_id, phone_number) VALUES (?, ?)`
  );

  // معاملة واحدة ذرية: إما تُنشأ الوظيفة وكل عناصرها معاً، أو لا شيء منها.
  // (node:sqlite لا يملك db.transaction() الجاهزة من better-sqlite3،
  // لذلك BEGIN/COMMIT/ROLLBACK صريحة هنا تعطي نفس الضمان يدوياً)
  db.exec('BEGIN');
  try {
    const info = insertJob.run(message_text, numbers.length, created_by);
    const jobId = info.lastInsertRowid;
    for (const number of numbers) {
      insertItem.run(jobId, number);
    }
    db.exec('COMMIT');
    return findById(jobId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function findById(id) {
  return db.prepare('SELECT * FROM bulk_jobs WHERE id = ?').get(id);
}

function findRecentJobs(limit = 20) {
  return db.prepare('SELECT * FROM bulk_jobs ORDER BY created_at DESC LIMIT ?').all(limit);
}

// أي وظيفة بقيت "pending" أو "processing" عند إعادة تشغيل الخادم — تُستأنف تلقائياً
function findResumableJobs() {
  return db.prepare(`SELECT * FROM bulk_jobs WHERE status IN ('pending', 'processing')`).all();
}

function updateStatus(id, status) {
  db.prepare(`UPDATE bulk_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    id
  );
}

function getItemsByStatus(jobId, status) {
  return db
    .prepare('SELECT * FROM bulk_job_items WHERE job_id = ? AND status = ? ORDER BY id ASC')
    .all(jobId, status);
}

function updateItemStatus(itemId, status, whatsappMessageId = null, error = null) {
  db.prepare(
    `UPDATE bulk_job_items
     SET status = ?, whatsapp_message_id = ?, error = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, whatsappMessageId, error, itemId);
}

function incrementSentCount(jobId) {
  db.prepare(
    `UPDATE bulk_jobs SET sent_count = sent_count + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(jobId);
}

function incrementFailedCount(jobId) {
  db.prepare(
    `UPDATE bulk_jobs SET failed_count = failed_count + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(jobId);
}

module.exports = {
  createJob,
  findById,
  findRecentJobs,
  findResumableJobs,
  updateStatus,
  getItemsByStatus,
  updateItemStatus,
  incrementSentCount,
  incrementFailedCount,
};
