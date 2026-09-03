// js/agent.js
// واجهة وكيل خدمة العملاء المبسّطة. يستخدم نفس api.js ونفس دوال
// localStorage (getToken/getStoredAdmin/...) المُعرَّفة هناك.
//
// المرحلة 9 — تعدد المحادثات: كل محادثة في "محادثاتي" مستقلة تماماً؛ وصول
// رسالة لمحادثة غير مفتوحة حالياً لا يفتحها ولا يزعج المحادثة المفتوحة،
// فقط يزيد unread_count الخاص بها ويُظهر 🔴 على صفّها. التحديث حي عبر
// Socket.IO (queue تبقى بالاستطلاع الدوري فقط، لا علاقة لها بهذه المرحلة)،
// مع استطلاع دوري أبطأ كشبكة أمان لو انقطع الاتصال الحي مؤقتاً.

let currentTab = 'queue';
let queueCache = [];
let mineCache = [];
let openCustomerId = null;
let pollTimer = null;
let socket = null;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(sqliteDatetime) {
  if (!sqliteDatetime) return '—';
  const iso = `${sqliteDatetime.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return sqliteDatetime;
  return d.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function setBtnLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.classList.toggle('loading', isLoading);
}

const STATE_LABELS = {
  CUSTOMER_SERVICE_WAITING: 'بانتظار وكيل',
  CUSTOMER_SERVICE_ACTIVE: 'محادثة نشطة',
  CUSTOMER_SERVICE_RATING: 'ينتظر تقييم العميل',
};

document.addEventListener('DOMContentLoaded', () => {
  if (!getToken()) {
    location.href = 'login.html';
    return;
  }

  const admin = getStoredAdmin();
  if (admin && admin.role !== 'agent') {
    location.href = 'dashboard.html'; // هذه الصفحة لوكلاء خدمة العملاء فقط
    return;
  }
  if (admin) {
    document.getElementById('agent-name').textContent = admin.name || admin.username;
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await apiRequest('/logout', { method: 'POST' });
    } catch (err) {
      // تجاهل: أفضل جهد فقط، لا يمنع تسجيل الخروج محلياً
    }
    if (socket) socket.disconnect();
    clearToken();
    localStorage.removeItem('admin');
    location.href = 'login.html';
  });

  document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('end-conversation-btn').addEventListener('click', handleEndConversation);
  document.getElementById('chat-reply-btn').addEventListener('click', handleSendReply);
  document.getElementById('chat-reply-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSendReply();
  });
  document.getElementById('chat-reply-attach-btn').addEventListener('click', () => {
    document.getElementById('chat-reply-file').click();
  });
  document.getElementById('chat-reply-file').addEventListener('change', (e) => {
    const label = document.getElementById('chat-reply-file-name');
    const file = e.target.files[0];
    label.style.display = file ? 'block' : 'none';
    label.textContent = file ? `📎 ${file.name}` : '';
  });

  refreshAll();
  connectSocket();
  // شبكة أمان أبطأ بعد وجود التحديث الحي (يلتقط تغيّرات الطابور، ويُعيد
  // المزامنة الكاملة لو انقطع اتصال Socket.IO مؤقتاً ثم عاد)
  pollTimer = setInterval(refreshAll, 15000);
});

/**
 * المرحلة 9: اتصال حي واحد طوال الجلسة، بنفس JWT المستخدَم في REST API.
 * فشل الاتصال (شبكة، خادم بلا هذا الإصدار بعد، ...) صامت عمداً — الاستطلاع
 * الدوري أعلاه يبقى شبكة الأمان، فلا تتعطل الصفحة لو تعذّر الاتصال الحي.
 */
function connectSocket() {
  socket = io({ auth: { token: getToken() } });

  socket.on('connect_error', (err) => {
    console.warn('[socket] تعذّر الاتصال الحي (سيستمر الاستطلاع الدوري كبديل):', err.message);
  });

  socket.on('conversation:new-message', (payload) => {
    const { customerId, message, unreadCount } = payload;

    if (String(customerId) === String(openCustomerId)) {
      // المحادثة المفتوحة فعلاً: أضف الرسالة مباشرة بلا إعادة جلب كاملة،
      // وصفّر unread فوراً على الخادم (لن يظهر 🔴 لمحادثة ينظر إليها الوكيل الآن)
      appendMessageToOpenThread(message);
      api.markCustomerAsRead(customerId).catch(() => {});
      return;
    }

    const idx = mineCache.findIndex((c) => String(c.id) === String(customerId));
    if (idx === -1) {
      refreshAll(); // محادثة غير موجودة في نسختنا المحلية بعد (تولٍّ حدث في تبويب آخر مثلاً) — أعد المزامنة كاملة
      return;
    }
    // لا تنقل الشاشة إلى هذه المحادثة، ولا تمسّ أي محادثة أخرى — فقط عدّاد هذا الصف
    mineCache[idx] = { ...mineCache[idx], unread_count: unreadCount };
    if (currentTab === 'mine') renderList();
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('topbar-title').textContent = tab === 'queue' ? 'الطابور' : 'محادثاتي';
  renderList();
}

async function refreshAll() {
  try {
    const [queueResult, mineResult] = await Promise.all([api.getCustomerServiceQueue(), api.getMyConversations()]);
    queueCache = queueResult.data;
    mineCache = mineResult.data;

    document.getElementById('queue-count').textContent = queueCache.length;
    document.getElementById('mine-count').textContent = mineCache.length;

    renderList();
  } catch (err) {
    // فشل صامت في الاستطلاع الدوري — لا نُزعج الوكيل بتنبيه متكرر
    console.error(err);
  }
}

function renderList() {
  const listEl = document.getElementById('conversation-list');
  const emptyEl = document.getElementById('list-empty');
  const items = currentTab === 'queue' ? queueCache : mineCache;

  if (items.length === 0) {
    listEl.innerHTML = '';
    document.getElementById('list-empty-text').textContent =
      currentTab === 'queue' ? 'لا توجد طلبات بانتظار وكيل حالياً.' : 'لا توجد محادثات نشطة لك حالياً.';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.innerHTML = items
    .map((c) => {
      const unreadBadge =
        currentTab === 'mine' && c.unread_count > 0
          ? `<span style="background:#e11d48; color:#fff; border-radius:999px; padding:2px 9px; font-size:11px; font-weight:700; white-space:nowrap;">🔴 ${c.unread_count}</span>`
          : '';
      return `
    <div class="conversation-list-item ${String(c.id) === String(openCustomerId) ? 'active' : ''}" data-id="${c.id}" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <div style="min-width:0;">
        <div class="mono" style="font-weight:600; font-size:13.5px;">${escapeHtml(c.phone_number)}</div>
        <div class="cell-muted" style="font-size:12px; margin-top:2px;">${STATE_LABELS[c.conversation_state] || ''} · ${formatDate(c.updated_at)}</div>
      </div>
      ${currentTab === 'queue' ? '<span class="btn btn-primary" style="padding:6px 12px; font-size:12px;">تولّي</span>' : unreadBadge}
    </div>
  `;
    })
    .join('');

  listEl.querySelectorAll('.conversation-list-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (currentTab === 'queue') {
        handleClaim(el.dataset.id);
      } else {
        openChat(el.dataset.id);
      }
    });
  });
}

async function handleClaim(customerId) {
  try {
    await api.claimConversation(customerId);
    showToast('تم تولّي المحادثة');
    switchTab('mine');
    await refreshAll();
    openChat(customerId);
  } catch (err) {
    showToast(err.message, 'error');
    refreshAll(); // قد تكون هذه المحادثة تولاها وكيل آخر للتو — حدّث القائمة
  }
}

async function openChat(customerId) {
  // فتح محادثة أخرى لا يغلق أو يمسّ أي محادثة أخرى في القائمة — فقط يُبدّل أي لوحة الدردشة معروضة حالياً
  openCustomerId = customerId;
  document.getElementById('chat-placeholder').classList.add('hidden');
  document.getElementById('chat-panel').classList.remove('hidden');
  document.getElementById('chat-thread').removeAttribute('data-last-message-id');

  const customer = mineCache.find((c) => String(c.id) === String(customerId));
  document.getElementById('chat-phone').textContent = customer ? customer.phone_number : '';
  document.getElementById('chat-state').textContent = customer ? STATE_LABELS[customer.conversation_state] || '' : '';

  renderList(); // لتحديث التظليل على العنصر المفتوح
  await refreshChatThread();
}

async function refreshChatThread() {
  if (!openCustomerId) return;
  try {
    const result = await api.getCustomerMessages(openCustomerId);
    renderChatThread(result.data.messages);

    // فتح المحادثة صفّر unread على الخادم (getCustomerMessages تفعل هذا في
    // المرحلة 9) — نعكس ذلك محلياً فوراً كي لا يظهر 🔴 قديم بعد إغلاق اللوحة وفتحها
    const idx = mineCache.findIndex((c) => String(c.id) === String(openCustomerId));
    if (idx !== -1) {
      mineCache[idx] = { ...mineCache[idx], unread_count: 0 };
      if (currentTab === 'mine') renderList();
    }
  } catch (err) {
    // إن فُقدت الصلاحية (مثال: انتهت المحادثة أو انتقلت لوكيل آخر) أغلق اللوحة بهدوء
    if (err.message && err.message.includes('صلاحية')) {
      closeChatPanel();
    }
  }
}

function renderChatThread(messages) {
  const threadEl = document.getElementById('chat-thread');
  if (messages.length === 0) {
    threadEl.innerHTML = '<p class="cell-muted">لا توجد رسائل بعد.</p>';
    threadEl.removeAttribute('data-last-message-id');
    return;
  }

  threadEl.innerHTML = messages.map((m) => chatBubbleHtml(m)).join('');
  threadEl.dataset.lastMessageId = String(messages[messages.length - 1].id);
  threadEl.scrollTop = threadEl.scrollHeight;
}

function chatBubbleHtml(m) {
  const attachmentLabels = { image: '🖼️ صورة', video: '🎥 فيديو', document: '📄 مستند' };
  const isInbound = m.direction === 'inbound';
  const align = isInbound ? 'flex-start' : 'flex-end';
  const bg = isInbound ? 'var(--bg)' : 'var(--accent-soft)';
  const label = isInbound ? 'العميل' : m.sent_by ? 'أنت' : 'البوت';
  const attachmentLine = m.attachment_type
    ? `<div style="font-size:12px; margin-bottom:4px;">${attachmentLabels[m.attachment_type] || '📎 مرفق'}</div>`
    : '';
  return `
    <div style="align-self:${align}; max-width:80%; background:${bg}; padding:8px 12px; border-radius:12px;">
      <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">${escapeHtml(label)} · ${formatDate(m.created_at)}</div>
      ${attachmentLine}
      <div style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(m.message || '')}</div>
    </div>
  `;
}

/**
 * المرحلة 9: يُضيف رسالة واحدة وصلت عبر Socket.IO للمحادثة المفتوحة حالياً
 * فقط — بلا أي إعادة جلب كاملة (فورية وأخف). يتجاهل بأمان لو وصلت نفس
 * الرسالة مرتين لأي سبب (نفس معرّفها الأخير المعروض فعلاً).
 */
function appendMessageToOpenThread(message) {
  const threadEl = document.getElementById('chat-thread');
  if (threadEl.dataset.lastMessageId === String(message.id)) return;

  if (threadEl.querySelector('p.cell-muted')) threadEl.innerHTML = ''; // كانت فارغة، هذه أول رسالة تصل الآن

  threadEl.insertAdjacentHTML('beforeend', chatBubbleHtml(message));
  threadEl.dataset.lastMessageId = String(message.id);
  threadEl.scrollTop = threadEl.scrollHeight;
}

function closeChatPanel() {
  openCustomerId = null;
  document.getElementById('chat-panel').classList.add('hidden');
  document.getElementById('chat-placeholder').classList.remove('hidden');
}

async function handleSendReply() {
  const input = document.getElementById('chat-reply-input');
  const fileInput = document.getElementById('chat-reply-file');
  const text = input.value.trim();
  const file = fileInput.files[0] || null;
  if (!text && !file) return;
  if (!openCustomerId) return;

  const btn = document.getElementById('chat-reply-btn');
  setBtnLoading(btn, true);
  try {
    await api.sendCustomerMessage(openCustomerId, { message: text, file });
    input.value = '';
    fileInput.value = '';
    document.getElementById('chat-reply-file-name').style.display = 'none';
    await refreshChatThread();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleEndConversation() {
  if (!openCustomerId) return;
  const btn = document.getElementById('end-conversation-btn');
  setBtnLoading(btn, true);
  try {
    await api.endConversation(openCustomerId);
    showToast('تم إنهاء المحادثة، وأُرسل طلب تقييم للعميل');
    closeChatPanel();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}
