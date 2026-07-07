/**
 * Wedding site server:
 *  - статика (приглашение, альбом, камера, QR, админка)
 *  - API загрузки фото гостями (лимит 10 на гостя, свои можно удалять)
 *  - модерация: фото видны в альбоме только после публикации админом
 *  - QR-код, ведущий на страницу камеры
 */
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_PHOTOS_PER_GUEST = 10;

const DATA_FILE = path.join(__dirname, 'data', 'photos.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- хранилище метаданных ----------
function loadPhotos() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function savePhotos(photos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(photos, null, 2));
}

// ---------- загрузка файлов ----------
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

// ---------- определение IP гостя ----------
// лимит фото считается по IP, чтобы смена браузера или очистка
// localStorage не позволяли обойти ограничение
function getIp(req) {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// фото «принадлежит» гостю, если совпал его id ИЛИ IP-адрес
function isOwn(photo, guestId, ip) {
  return (guestId && photo.guestId === guestId) || (ip && photo.ip === ip);
}

// ---------- админ-сессии (в памяти) ----------
const adminTokens = new Set();
function isAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return adminTokens.has(token);
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход администратора' });
  next();
}

app.set('trust proxy', true); // корректный req.ip за туннелем/прокси (cloudflared, ngrok)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/vendor/gsap', express.static(path.join(__dirname, 'node_modules', 'gsap', 'dist')));
app.get('/content.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'content.json'));
});

// ---------- публичное API ----------

// опубликованные фото — для страницы «Альбом»
app.get('/api/photos/published', (req, res) => {
  const photos = loadPhotos()
    .filter((p) => p.published)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, filename, guestName, uploadedAt }) => ({
      id,
      url: `/uploads/${filename}`,
      guestName: guestName || '',
      uploadedAt,
    }));
  res.json(photos);
});

// свои фото гостя (любой статус) — по id браузера и по IP,
// чтобы в новом браузере гость видел свои прежние фото
app.get('/api/photos/mine', (req, res) => {
  const guestId = req.query.guestId;
  const ip = getIp(req);
  const photos = loadPhotos()
    .filter((p) => isOwn(p, guestId, ip))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, filename, published, uploadedAt }) => ({
      id,
      url: `/uploads/${filename}`,
      published,
      uploadedAt,
    }));
  res.json({ photos, limit: MAX_PHOTOS_PER_GUEST });
});

// загрузка фото гостем
app.post('/api/photos', upload.single('photo'), (req, res) => {
  const { guestId, guestName } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Файл не получен или это не изображение' });
  if (!guestId) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Нет идентификатора гостя' });
  }
  const ip = getIp(req);
  const photos = loadPhotos();
  // считаем и по guestId, и по IP — смена браузера не сбрасывает лимит
  const mine = photos.filter((p) => isOwn(p, guestId, ip));
  if (mine.length >= MAX_PHOTOS_PER_GUEST) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: `Лимит ${MAX_PHOTOS_PER_GUEST} фото исчерпан` });
  }
  const photo = {
    id: crypto.randomUUID(),
    guestId,
    ip,
    guestName: (guestName || '').slice(0, 60),
    filename: req.file.filename,
    uploadedAt: Date.now(),
    published: false,
  };
  photos.push(photo);
  savePhotos(photos);
  res.json({
    id: photo.id,
    url: `/uploads/${photo.filename}`,
    published: false,
    remaining: MAX_PHOTOS_PER_GUEST - mine.length - 1,
  });
});

// удаление: гость — только своё, админ — любое
app.delete('/api/photos/:id', (req, res) => {
  const photos = loadPhotos();
  const idx = photos.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Фото не найдено' });
  const photo = photos[idx];
  const own = isOwn(photo, req.query.guestId, getIp(req));
  if (!own && !isAdmin(req)) return res.status(403).json({ error: 'Можно удалять только свои фото' });
  photos.splice(idx, 1);
  savePhotos(photos);
  fs.unlink(path.join(UPLOADS_DIR, photo.filename), () => {});
  res.json({ ok: true });
});

// QR-код, ведущий на страницу камеры
app.get('/api/qr', async (req, res) => {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = `${proto}://${host}/camera.html`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 640,
    margin: 2,
    color: { dark: '#5c2a33', light: '#fff8f6' },
  });
  res.json({ url, qr: dataUrl });
});

// ---------- API администратора ----------

app.post('/api/admin/login', (req, res) => {
  if ((req.body.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

app.get('/api/admin/photos', requireAdmin, (req, res) => {
  const photos = loadPhotos()
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, filename, guestId, guestName, published, uploadedAt, ip }) => ({
      id,
      url: `/uploads/${filename}`,
      guestId,
      guestName: guestName || '',
      ip: ip || '',
      published,
      uploadedAt,
    }));
  res.json(photos);
});

app.post('/api/admin/photos/:id/publish', requireAdmin, (req, res) => {
  const photos = loadPhotos();
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Фото не найдено' });
  photo.published = !!req.body.published;
  savePhotos(photos);
  res.json({ ok: true, published: photo.published });
});

// опубликовать все непубликованные разом
app.post('/api/admin/photos/publish-all', requireAdmin, (req, res) => {
  const photos = loadPhotos();
  let count = 0;
  for (const p of photos) {
    if (!p.published) {
      p.published = true;
      count++;
    }
  }
  savePhotos(photos);
  res.json({ ok: true, count });
});

// обработчик ошибок — отдаём JSON и пишем в консоль
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.url, err);
  res.status(err.status || 500).json({ error: err.message || 'Ошибка сервера' });
});

// ---------- запуск ----------
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  console.log(`Приглашение:  http://localhost:${PORT}`);
  if (lan) console.log(`В локальной сети (для QR): http://${lan.address}:${PORT}`);
  console.log(`Админка:      http://localhost:${PORT}/admin.html  (пароль: ${ADMIN_PASSWORD})`);
});
