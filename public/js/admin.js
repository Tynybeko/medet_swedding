/* Админка: вход по паролю, публикация/снятие с публикации, удаление любых фото. */

let token = sessionStorage.getItem('admin-token') || null;
let tab = 'pending';
let photos = [];

const loginView = document.getElementById('login-view');
const panelView = document.getElementById('panel-view');
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const stats = document.getElementById('stats');
const toast = document.getElementById('toast');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

function authHeaders() {
  return { Authorization: 'Bearer ' + token };
}

/* ---------- вход ---------- */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    document.getElementById('login-error').textContent = 'Сырсөз туура эмес';
    gsap.fromTo('#login-form', { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    return;
  }
  token = (await res.json()).token;
  sessionStorage.setItem('admin-token', token);
  enterPanel();
});

function enterPanel() {
  loginView.hidden = true;
  panelView.hidden = false;
  gsap.from('#panel-view', { opacity: 0, y: 24, duration: 0.7, ease: 'power3.out' });
  refresh();
}

/* ---------- данные ---------- */
async function refresh() {
  const res = await fetch('/api/admin/photos', { headers: authHeaders() });
  if (res.status === 401) {
    sessionStorage.removeItem('admin-token');
    token = null;
    loginView.hidden = false;
    panelView.hidden = true;
    return;
  }
  photos = await res.json();
  const pub = photos.filter((p) => p.published).length;
  stats.textContent = `Баары: ${photos.length} · Жарыяланды: ${pub} · Күтүүдө: ${photos.length - pub}`;
  render();
}

function render() {
  const list = photos.filter((p) =>
    tab === 'pending' ? !p.published : tab === 'published' ? p.published : true
  );
  empty.hidden = list.length > 0;
  grid.innerHTML = '';
  list.forEach((p, i) => {
    const date = new Date(p.uploadedAt).toLocaleString('ky-KG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'admin-item';
    item.innerHTML = `
      <img src="${p.url}" alt="" loading="lazy" style="cursor:zoom-in" />
      <div class="meta">
        <span class="badge ${p.published ? 'pub' : ''}">${p.published ? 'Альбомдо' : 'Текшерилүүдө'}</span><br/>
        ${p.guestName ? '📷 ' + escapeHtml(p.guestName) + ' · ' : ''}${date}${p.ip ? '<br/>IP: ' + escapeHtml(p.ip) : ''}
      </div>
      <div class="actions">
        <button class="pub-btn ${p.published ? 'on' : ''}">${p.published ? 'Жашыруу' : 'Жарыялоо'}</button>
        <button class="del-btn">Өчүрүү</button>
      </div>`;
    item.querySelector('img').addEventListener('click', () => window.open(p.url, '_blank'));
    item.querySelector('.pub-btn').addEventListener('click', async () => {
      await fetch(`/api/admin/photos/${p.id}/publish`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !p.published }),
      });
      showToast(p.published ? 'Жарыялангандардан алынды' : 'Альбомго жарыяланды ✓');
      refresh();
    });
    item.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('Бул сүрөт биротоло өчүрүлсүнбү?')) return;
      gsap.to(item, { opacity: 0, scale: 0.85, duration: 0.3 });
      await fetch(`/api/photos/${p.id}`, { method: 'DELETE', headers: authHeaders() });
      showToast('Сүрөт өчүрүлдү');
      refresh();
    });
    grid.appendChild(item);
    gsap.from(item, { opacity: 0, y: 18, duration: 0.45, delay: Math.min(i * 0.04, 0.5), ease: 'power2.out' });
  });
}

/* ---------- вкладки и массовая публикация ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
});

document.getElementById('publish-all').addEventListener('click', async () => {
  const res = await fetch('/api/admin/photos/publish-all', { method: 'POST', headers: authHeaders() });
  const { count } = await res.json();
  showToast(count ? `Жарыяланган сүрөттөр: ${count}` : 'Жаңы сүрөт жок');
  refresh();
});

/* ---------- старт ---------- */
if (token) {
  // проверяем, жив ли токен
  fetch('/api/admin/photos', { headers: authHeaders() }).then((r) => {
    if (r.ok) enterPanel();
    else sessionStorage.removeItem('admin-token');
  });
}
setInterval(() => { if (token && !panelView.hidden) refresh(); }, 15000);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Топторго арналган QR барактары ---------- */
const qrGroupsEl = document.getElementById('qr-groups');
const QR_GROUPS_KEY = 'wedding-qr-groups-v1';
let qrGroups = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(QR_GROUPS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (_) { /* сакталган маалымат бузулса, демейки топту көрсөтөбүз */ }
  return [{ label: 'Достор', pages: 1 }];
})();

function saveQrGroups() {
  localStorage.setItem(QR_GROUPS_KEY, JSON.stringify(qrGroups));
}

function renderQrGroups() {
  qrGroupsEl.innerHTML = '';
  qrGroups.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'qr-group-row';
    row.innerHTML = `
      <label>Топтун аты<input class="rsvp-input qr-group-label" maxlength="50" value="${escapeHtml(String(group.label || ''))}" placeholder="Мисалы: Достор"></label>
      <label>Барактардын саны<input class="rsvp-input qr-group-pages" type="number" min="1" max="100" value="${Math.max(1, Math.min(100, Number(group.pages) || 1))}"></label>
      <button class="qr-group-remove" type="button" aria-label="Топту өчүрүү">×</button>`;
    row.querySelector('.qr-group-label').addEventListener('input', (event) => {
      qrGroups[index].label = event.target.value;
      saveQrGroups();
    });
    row.querySelector('.qr-group-pages').addEventListener('input', (event) => {
      qrGroups[index].pages = Math.max(1, Math.min(100, Number(event.target.value) || 1));
      saveQrGroups();
    });
    row.querySelector('.qr-group-remove').addEventListener('click', () => {
      qrGroups.splice(index, 1);
      if (!qrGroups.length) qrGroups.push({ label: '', pages: 1 });
      saveQrGroups();
      renderQrGroups();
    });
    qrGroupsEl.appendChild(row);
  });
}

function getQrGroups() {
  const groups = qrGroups.map(({ label, pages }) => ({ label: String(label || '').trim(), pages: Number(pages) || 1 }));
  const total = groups.reduce((sum, group) => sum + group.pages, 0);
  if (groups.some((group) => !group.label)) {
    showToast('Ар бир топко ат жазыңыз');
    return null;
  }
  if (groups.length > 25 || total > 100 || groups.some((group) => group.pages < 1 || group.pages > 100)) {
    showToast('25 топко жана жалпысынан 100 баракка чейин кошууга болот');
    return null;
  }
  return groups;
}

document.getElementById('add-qr-group').addEventListener('click', () => {
  qrGroups.push({ label: '', pages: 1 });
  saveQrGroups();
  renderQrGroups();
  qrGroupsEl.lastElementChild.querySelector('.qr-group-label').focus();
});
document.getElementById('download-qr-pdf').addEventListener('click', () => {
  const groups = getQrGroups();
  if (!groups) return;
  window.location.href = `/api/qr.pdf?groups=${encodeURIComponent(JSON.stringify(groups))}`;
});
document.getElementById('print-qr-pages').addEventListener('click', () => {
  const groups = getQrGroups();
  if (!groups) return;
  const params = new URLSearchParams({ groups: JSON.stringify(groups), print: '1' });
  window.open(`/qr.html?${params}`, '_blank', 'noopener');
});
renderQrGroups();
