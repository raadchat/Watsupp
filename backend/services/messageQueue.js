// services/messageQueue.js
// طابور معالجة الرسائل الجماعية: يرسل رقماً واحداً في كل مرة مع تأخير بينها
// (BULK_MESSAGE_DELAY_MS) بدل إرسال كل الأرقام دفعة واحدة، مراعاةً لحدود
// WhatsApp API ومعدل الإرسال كما هو مطلوب صراحة في المواصفات.
//
// افتراض مذكور بوضوح: المواصفات لم تفرض تقنية طابور معينة (مثل Redis/Bull).
// نظراً لعدم توفر خدمة Redis خارجية بافتراض النشر البسيط لهذا المشروع،
// اعتُمد طابور داخل نفس عملية Node.js مدعوم بجدول bulk_job_items في قاعدة
// البيانات (وليس في الذاكرة فقط)، بحيث تبقى حالة كل رقم قابلة للاستعلام حتى
// لو أعيد تشغيل الخادم. هذا خيار قياسي وقابل للتبديل: لحمل أكبر يعمل على
// أكثر من عملية/خادم، يُنصح بالانتقال إلى Redis + BullMQ لاحقاً.

const bulkJobsRepository = require('../database/repositories/bulkJobsRepository');
const whatsappService = require('./whatsappService');

const DELAY_MS = Number(process.env.BULK_MESSAGE_DELAY_MS) || 1200;

// يمنع معالجة نفس job_id أكثر من مرة في نفس العملية إذا استُدعي enqueue مرتين
const activeJobs = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob(jobId) {
  const job = bulkJobsRepository.findById(jobId);
  if (!job) return;

  bulkJobsRepository.updateStatus(jobId, 'processing');

  const pendingItems = bulkJobsRepository.getItemsByStatus(jobId, 'pending');

  for (const item of pendingItems) {
    const result = await whatsappService.sendTextMessage(item.phone_number, job.message_text);

    if (result.success) {
      bulkJobsRepository.updateItemStatus(item.id, 'sent', result.messageId, null);
      bulkJobsRepository.incrementSentCount(jobId);
    } else {
      bulkJobsRepository.updateItemStatus(item.id, 'failed', null, result.error);
      bulkJobsRepository.incrementFailedCount(jobId);
    }

    await sleep(DELAY_MS); // احترام معدل الإرسال بين رسالة وأخرى
  }

  bulkJobsRepository.updateStatus(jobId, 'completed');
}

/** يضيف وظيفة إلى المعالجة الفورية دون حجب طلب HTTP (يعمل في الخلفية). */
function enqueueBulkJob(jobId) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  processJob(jobId)
    .catch((err) => {
      console.error(`[messageQueue] job ${jobId} failed:`, err);
      bulkJobsRepository.updateStatus(jobId, 'failed');
    })
    .finally(() => activeJobs.delete(jobId));
}

/** يُستدعى عند إقلاع الخادم لاستئناف أي وظائف بقيت معلّقة من تشغيل سابق. */
function resumePendingJobs() {
  const jobs = bulkJobsRepository.findResumableJobs();
  for (const job of jobs) {
    console.log(`[messageQueue] استئناف الوظيفة المعلّقة #${job.id}`);
    enqueueBulkJob(job.id);
  }
}

module.exports = { enqueueBulkJob, resumePendingJobs };
