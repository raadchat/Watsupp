// utils/asyncHandler.js
// Express (v4) لا يلتقط تلقائياً الأخطاء المرفوضة (rejected) من دوال async.
// هذا الغلاف يمرّر أي خطأ إلى next() ليصل إلى middleware/errorHandler.js
// بدل أن يعلّق الطلب أو يسبب Unhandled Promise Rejection.

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
