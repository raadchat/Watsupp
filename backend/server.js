// backend/server.js
// نقطة الدخول الوحيدة: يهيّئ قاعدة البيانات، يركّب middleware الأمان، يربط
// كل مسارات API، ثم يخدم لوحة التحكم (frontend/) كملفات ثابتة من نفس الخادم
// (نفس الأصل origin، بلا تعقيد CORS بين اللوحة والـ API في وضع التشغيل الافتراضي).

require('dotenv').config();

// (المرحلة 3 — إعدادات ENV الذكية): JWT_SECRET لم يعد إلزامياً في .env.
// إن لم يُضبط صراحةً، database/db.js يضمن وجود قيمة مولَّدة تلقائياً وآمنة
// ومخزَّنة بشكل دائم منذ أول إقلاع (راجع ensureSystemSettingsMigration
// وdatabase/repositories/systemSettingsRepository.getJwtSecret) — فلا حاجة
// لأي فحص فادح أو process.exit هنا بعد الآن.

const optionalButRecommended = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN'];
const missing = optionalButRecommended.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.log(
    '[server] بيانات اتصال واتساب غير مضبوطة في .env — لا مشكلة، يمكن ضبطها الآن ' +
      'من صفحة "الاتصال بواتساب" داخل لوحة التحكم بعد تسجيل الدخول.'
  );
}

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { getUploadsDir } = require('./utils/paths');
const { logSafeError } = require('./utils/errors');

// يهيّئ الاتصال وينفّذ schema.sql عند أول استيراد
require('./database/db');
const systemSettingsRepository = require('./database/repositories/systemSettingsRepository');

const authRoutes = require('./routes/auth');
const logoutRoute = require('./routes/logout');
const categoriesRoutes = require('./routes/categories');
const servicesRoutes = require('./routes/services');
const customersRoutes = require('./routes/customers');
const messagesRoutes = require('./routes/messages');
const settingsRoutes = require('./routes/settings');
const botSettingsRoutes = require('./routes/botSettings');
const botTextsRoutes = require('./routes/botTexts');
const customerServiceRoutes = require('./routes/customerService');
const usersRoutes = require('./routes/users');
const whatsappRoutes = require('./routes/whatsapp');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const messageQueue = require('./services/messageQueue');

const app = express();
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// --- أمان عام -------------------------------------------------------------
app.use(
  helmet({
    // مبسّط لتفادي كسر أصول لوحة التحكم الثابتة (CSS/JS من نفس الأصل)؛
    // شدّد هذه السياسة عند النشر الفعلي حسب مصادر الأصول التي تستخدمها.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(generalLimiter);

// --- مسارات API -------------------------------------------------------------
app.use('/api/login', authRoutes);
app.use('/api/logout', logoutRoute);
app.use('/api/categories', categoriesRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/bot-settings', botSettingsRoutes);
app.use('/api/bot-texts', botTextsRoutes);
app.use('/api/customer-service', customerServiceRoutes);
app.use('/api/users', usersRoutes);
app.use('/webhook', whatsappRoutes);

// أي مسار /api/* غير معروف يُعامَل كـ 404 بالصيغة الموحدة (وليس صفحة HTML افتراضية)
app.use('/api', notFoundHandler);

// --- صور مرفوعة (رسالة الترحيب) ----------------------------------------------
// مسار مستقل عن ملفات اللوحة الثابتة عمداً، ويُقرأ من UPLOADS_DIR القابل
// للضبط — على منصات بنظام ملفات مؤقت (Railway مثلاً) اضبطه على مسار داخل
// Volume دائم بدل الاعتماد على القرص المؤقت الافتراضي (راجع README).
const UPLOADS_DIR = getUploadsDir();
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// --- لوحة التحكم (ملفات ثابتة) ----------------------------------------------
app.use(express.static(FRONTEND_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'login.html'));
});

// --- معالج الأخطاء الموحّد (يجب أن يكون آخر middleware) ----------------------
app.use(errorHandler);

// --- Socket.IO (المرحلة 9 — تعدد محادثات خدمة العملاء، تحديث حي) -----------
// يلتف حول نفس تطبيق Express (لا خادم HTTP ثانٍ، ولا منفذ إضافي). كل اتصال
// يُصادَق بنفس JWT المستخدَم في REST API (نفس السرّ عبر systemSettingsRepository)،
// وينضمّ فوراً لغرفة خاصة بمعرّف المستخدم (admin أو agent سواء) — أي حدث
// يُرسَل لاحقاً لذلك المستخدم تحديداً (كل تبويبات/أجهزة تسجيل دخوله معاً)
// عبر io.to(`user:{id}`)، بلا بث عام لأي بيانات لغير صاحبها.
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('رمز الدخول مفقود'));
  jwt.verify(token, systemSettingsRepository.getJwtSecret(), (err, decoded) => {
    if (err) return next(new Error('رمز الدخول غير صالح'));
    socket.user = decoded; // { id, username, role, name } — نفس محتوى توكن REST
    next();
  });
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.on('disconnect', () => {}); // لا حاجة لأي تنظيف يدوي — Socket.IO يزيل العضوية تلقائياً
});

app.set('io', io); // يُستخدَم من webhookController عبر req.app.get('io') فقط — لا وحدة وسيطة إضافية

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`[server] الخادم يعمل على المنفذ ${PORT}`);
  console.log(`[server] لوحة التحكم: http://localhost:${PORT}/`);
  console.log(`[server] Webhook: http://localhost:${PORT}/webhook`);

  // استئناف أي وظائف إرسال جماعي بقيت معلّقة من تشغيل سابق للخادم
  messageQueue.resumePendingJobs();
});

// لا نُسقط الخادم على أخطاء غير متوقعة في وعود لم تُمسك — نسجّلها فقط
process.on('unhandledRejection', (reason) => {
  logSafeError('[unhandledRejection]', reason);
});
