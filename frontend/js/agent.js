// js/agent.js
// واجهة وكيل خدمة العملاء المبسّطة. يستخدم نفس api.js ونفس دوال
// localStorage (getToken/getStoredAdmin/...) المُعرَّفة هناك.

let currentTab = 'queue';
let queueCache = [];
let mineCache = [];
let openCustomerId = null;
let pollTimer = null;

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

  document.getElementById('logout-btn').addEventListener('click', () => {
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

  refreshAll();
  pollTimer = setInterval(refreshAll, 5000); // تحديث دوري: طابور جديد، أو رد عميل وصل أثناء محادثة مفتوحة
});

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

    // إن كانت هناك محادثة مفتوحة حالياً، حدّث نص المحادثة أيضاً (رد عميل جديد مثلاً)
    if (openCustomerId) {
      refreshChatThread();
    }
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
    .map(
      (c) => `
    <div class="conversation-list-item ${String(c.id) === String(openCustomerId) ? 'active' : ''}" data-id="${c.id}" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div class="mono" style="font-weight:600; font-size:13.5px;">${escapeHtml(c.phone_number)}</div>
        <div class="cell-muted" style="font-size:12px; margin-top:2px;">${STATE_LABELS[c.conversation_state] || ''} · ${formatDate(c.updated_at)}</div>
      </div>
      ${currentTab === 'queue' ? '<span class="btn btn-primary" style="padding:6px 12px; font-size:12px;">تولّي</span>' : ''}
    </div>
  `
    )
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
  openCustomerId = customerId;
  document.getElementById('chat-placeholder').classList.add('hidden');
  document.getElementById('chat-panel').classList.remove('hidden');

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
    return;
  }

  threadEl.innerHTML = messages
    .map((m) => {
      const isInbound = m.direction === 'inbound';
      const align = isInbound ? 'flex-start' : 'flex-end';
      const bg = isInbound ? 'var(--bg)' : 'var(--accent-soft)';
      const label = isInbound ? 'العميل' : m.sent_by ? 'أنت' : 'البوت';
      return `
        <div style="align-self:${align}; max-width:80%; background:${bg}; padding:8px 12px; border-radius:12px;">
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">${escapeHtml(label)} · ${formatDate(m.created_at)}</div>
          <div style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(m.message || '')}</div>
        </div>
      `;
    })
    .join('');

  threadEl.scrollTop = threadEl.scrollHeight;
}

function closeChatPanel() {
  openCustomerId = null;
  document.getElementById('chat-panel').classList.add('hidden');
  document.getElementById('chat-placeholder').classList.remove('hidden');
}

async function handleSendReply() {
  const input = document.getElementById('chat-reply-input');
  const text = input.value.trim();
  if (!text || !openCustomerId) return;

  const btn = document.getElementById('chat-reply-btn');
  setBtnLoading(btn, true);
  try {
    await api.sendCustomerMessage(openCustomerId, text);
    input.value = '';
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
