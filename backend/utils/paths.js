// utils/paths.js
// مكان واحد يقرر فيه المشروع مسار مجلد uploads/ — بدل تكراره في أكثر من
// ملف. قابل للضبط عبر UPLOADS_DIR في .env (مهم على منصات مثل Railway حيث
// نظام الملفات الافتراضي مؤقت (ephemeral) ويُمسَح عند كل إعادة نشر —
// راجع القسم المخصَّص في README لشرح استخدام Railway Volume مع هذا المتغيّر).

const path = require('path');

function getUploadsDir() {
  return process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'frontend', 'uploads');
}

module.exports = { getUploadsDir };
