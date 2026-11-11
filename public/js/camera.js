/* Страница камеры: авто-запуск камеры, съёмка в высоком качестве,
   лимит 10 фото на гостя, удаление своих фото. */

const guestId = (() => {
  let id = localStorage.getItem('guest-id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
    localStorage.setItem('guest-id', id);
  }
  return id;
})();

const nameInput = document.getElementById('guest-name');
nameInput.value = localStorage.getItem('guest-name') || '';
nameInput.addEventListener('input', () => localStorage.setItem('guest-name', nameInput.value));

const video = document.getElementById('video');
const preview = document.getElementById('preview');
const flash = document.getElementById('flash');
const errBox = document.getElementById('camera-error');
const shutter = document.getElementById('shutter');
const fileInput = document.getElementById('file-input');
const liveControls = document.getElementById('live-controls');
const confirmControls = document.getElementById('confirm-controls');
const counter = document.getElementById('counter');
const mineGrid = document.getElementById('mine');
const toast = document.getElementById('toast');

let stream = null;
let imageCapture = null;
let pendingBlob = null;
let usedCount = 0;
let limit = 10;

function t(key) {
  return (window.Content && Content.get(key)) || '';
}
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ---------- камера: сразу запускаем при открытии страницы ---------- */
async function startCamera() {
  errBox.style.display = 'none';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 4096 },
        height: { ideal: 3072 },
      },
      audio: false,
    });
    video.srcObject = stream;
    // ImageCapture даёт полное разрешение сенсора, если поддерживается
    const track = stream.getVideoTracks()[0];
    imageCapture = 'ImageCapture' in window ? new ImageCapture(track) : null;
    gsap.from('.camera-stage', { opacity: 0, y: 24, duration: 0.8, ease: 'power3.out' });
  } catch (e) {
    // getUserMedia недоступен (нет разрешения или страница открыта не по HTTPS) —
    // переключаемся на нативную камеру телефона: тап по кнопке открывает её напрямую
    errBox.textContent = t('camera.cameraDenied') || 'Камерага уруксат берилген жок — галереядан сүрөт тандаңыз.';
    errBox.style.display = 'flex';
    shutter.style.display = 'none';
    fileInput.setAttribute('capture', 'environment');
    const label = fileInput.closest('label');
    label.classList.remove('link-like');
    label.classList.add('btn');
    label.querySelector('span').textContent = '📷 Камераны ачуу';
  }
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((tr) => tr.stop());
  stream = null;
}

/* ---------- съёмка ---------- */
async function takePhoto() {
  if (usedCount >= limit) {
    showToast(t('camera.limitReached'));
    return;
  }
  gsap.fromTo(flash, { opacity: 0.9 }, { opacity: 0, duration: 0.5 });
  let blob = null;
  try {
    if (imageCapture && imageCapture.takePhoto) {
      // полное качество с сенсора камеры
      blob = await imageCapture.takePhoto();
    }
  } catch (e) {
    blob = null;
  }
  if (!blob) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  }
  showConfirm(blob);
}

function showConfirm(blob) {
  pendingBlob = blob;
  preview.src = URL.createObjectURL(blob);
  preview.hidden = false;
  video.style.visibility = 'hidden';
  liveControls.style.display = 'none';
  confirmControls.style.display = 'flex';
  gsap.from(preview, { opacity: 0, scale: 1.04, duration: 0.5, ease: 'power2.out' });
}

function backToLive() {
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.hidden = true;
  pendingBlob = null;
  video.style.visibility = 'visible';
  liveControls.style.display = 'flex';
  confirmControls.style.display = 'none';
}

shutter.addEventListener('click', takePhoto);
document.getElementById('retake-btn').addEventListener('click', backToLive);

/* выбор из галереи — исходный файл, без пережатия */
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) showConfirm(file);
  fileInput.value = '';
});

/* ---------- загрузка ---------- */
document.getElementById('use-btn').addEventListener('click', async () => {
  if (!pendingBlob) return;
  const btn = document.getElementById('use-btn');
  btn.disabled = true;
  const fd = new FormData();
  fd.append('photo', pendingBlob, 'photo.jpg');
  fd.append('guestId', guestId);
  fd.append('guestName', nameInput.value.trim());
  try {
    const res = await fetch('/api/photos', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Жүктөө ишке ашкан жок');
    showToast(t('camera.uploaded'));
    backToLive();
    await refreshMine();
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- мои фото ---------- */
async function refreshMine() {
  const res = await fetch(`/api/photos/mine?guestId=${encodeURIComponent(guestId)}`);
  const { photos, limit: lim } = await res.json();
  limit = lim;
  usedCount = photos.length;

  const tmpl = t('camera.counter') || '{used} / {limit} сүрөт';
  counter.textContent = tmpl.replace('{used}', usedCount).replace('{limit}', limit);

  const limitReached = usedCount >= limit;
  shutter.disabled = limitReached;
  shutter.style.opacity = limitReached ? 0.35 : 1;
  if (limitReached) showToast(t('camera.limitReached'));

  mineGrid.innerHTML = '';
  photos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'mine-item';
    const st = p.published ? t('camera.published') || 'Альбомдо' : t('camera.pending') || 'Текшерилүүдө';
    item.innerHTML = `
      <img src="${p.url}" alt="" loading="lazy" />
      <span class="status ${p.published ? 'pub' : ''}">${st}</span>
      <button class="del" title="${t('camera.delete') || 'Өчүрүү'}">✕</button>`;
    item.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(t('camera.confirmDelete') || 'Бул сүрөт өчүрүлсүнбү?')) return;
      gsap.to(item, { opacity: 0, scale: 0.8, duration: 0.3 });
      await fetch(`/api/photos/${p.id}?guestId=${encodeURIComponent(guestId)}`, { method: 'DELETE' });
      refreshMine();
    });
    mineGrid.appendChild(item);
    gsap.from(item, { opacity: 0, y: 20, duration: 0.5, delay: i * 0.05, ease: 'power2.out' });
  });
}

/* ---------- старт ---------- */
startCamera();
refreshMine();
setInterval(refreshMine, 8000); // подхватываем смену статуса модерации
window.addEventListener('pagehide', stopCamera);
