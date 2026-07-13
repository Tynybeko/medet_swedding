/**
 * Wedding site — Express-приложение (общее для локального запуска и Vercel).
 *
 * Хранение фото (по приоритету):
 *  - CLOUDINARY_URL задан — фото в Cloudinary (бесплатно, без Vercel Storage);
 *    статус модерации — тег pending/published, гость и IP — в context;
 *  - BLOB_READ_WRITE_TOKEN задан — фото в Vercel Blob,
 *    метаданные закодированы прямо в имени файла;
 *  - иначе (локально) — папка uploads/ + data/photos.json.
 *
 * Правила: лимит 10 фото на гостя (по guestId И по IP), гость удаляет только
 * своё, фото видны в альбоме лишь после публикации админом.
 */
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_PHOTOS_PER_GUEST = 10;
const BLOB_MODE = !!process.env.BLOB_READ_WRITE_TOKEN;
const CLOUDINARY_MODE = !!process.env.CLOUDINARY_URL;

/* ==================== слой хранения ==================== */
/* Единый интерфейс: list() / add() / remove() / setPublished() —
   все методы async и возвращают записи вида
   { id, guestId, ip, guestName, published, uploadedAt, url } */

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif' };

let storage;

if (CLOUDINARY_MODE) {
  const cloudinary = require('cloudinary').v2; // конфиг берётся из CLOUDINARY_URL
  const b64 = (s) => Buffer.from(s || '', 'utf8').toString('base64url');
  const unb64 = (s) => Buffer.from(s || '', 'base64url').toString('utf8');

  // Admin API Cloudinary имеет лимит запросов, поэтому список кэшируем
  // в памяти на несколько секунд; любая запись сбрасывает кэш
  const CACHE_TTL = 15 * 1000;
  let cache = { at: 0, data: null };
  const invalidate = () => { cache = { at: 0, data: null }; };

  function toRecord(r) {
    const ctx = (r.context && r.context.custom) || {};
    return {
      id: r.public_id.split('/').pop(),
      publicId: r.public_id,
      guestId: unb64(ctx.g),
      ip: unb64(ctx.i),
      guestName: unb64(ctx.n),
      uploadedAt: Number(ctx.ts) || Date.parse(r.created_at) || 0,
      published: (r.tags || []).includes('published'),
      url: r.secure_url,
    };
  }

  storage = {
    async list() {
      if (cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
      const out = [];
      let next_cursor;
      do {
        const r = await cloudinary.api.resources({
          type: 'upload',
          prefix: 'wedding/',
          max_results: 500,
          context: true,
          tags: true,
          next_cursor,
        });
        out.push(...r.resources);
        next_cursor = r.next_cursor;
      } while (next_cursor);
      const data = out.map(toRecord);
      cache = { at: Date.now(), data };
      return data;
    },
    async add({ buffer, contentType, guestId, ip, guestName }) {
      const id = crypto.randomUUID();
      const result = await new Promise((resolve, reject) => {
        const s = cloudinary.uploader.upload_stream(
          {
            public_id: `wedding/${id}`,
            resource_type: 'image',
            tags: ['pending'],
            context: { g: b64(guestId), i: b64(ip), n: b64(guestName), ts: String(Date.now()) },
          },
          (err, res) => (err ? reject(err) : resolve(res)),
        );
        s.end(buffer);
      });
      invalidate();
      return { id, publicId: result.public_id, guestId, ip, guestName, uploadedAt: Date.now(), published: false, url: result.secure_url };
    },
    async remove(rec) {
      await cloudinary.uploader.destroy(rec.publicId, { invalidate: true });
      invalidate();
    },
    async setPublished(rec, published) {
      // replace_tag заменяет все теги — статус у фото ровно один
      await cloudinary.uploader.replace_tag(published ? 'published' : 'pending', [rec.publicId]);
      invalidate();
    },
  };
} else if (BLOB_MODE) {
  const { put, del, list, copy } = require('@vercel/blob');
  const b64 = (s) => Buffer.from(s || '', 'utf8').toString('base64url');
  const unb64 = (s) => Buffer.from(s || '', 'base64url').toString('utf8');

  // photos/{pending|published}/{id}__{guestId}__{ip}__{name}__{ts}{ext}
  function makePathname(rec, ext) {
    const status = rec.published ? 'published' : 'pending';
    return `photos/${status}/${rec.id}__${b64(rec.guestId)}__${b64(rec.ip)}__${b64(rec.guestName)}__${rec.uploadedAt}${ext}`;
  }
  function parseBlob(blob) {
    const m = blob.pathname.match(/^photos\/(pending|published)\/(.+?)(\.[a-z0-9]+)?$/i);
    if (!m) return null;
    const parts = m[2].split('__');
    if (parts.length !== 5) return null;
    return {
      id: parts[0],
      guestId: unb64(parts[1]),
      ip: unb64(parts[2]),
      guestName: unb64(parts[3]),
      uploadedAt: Number(parts[4]) || 0,
      published: m[1] === 'published',
      url: blob.url,
      pathname: blob.pathname,
    };
  }

  async function listAll() {
    const out = [];
    let cursor;
    do {
      const r = await list({ prefix: 'photos/', cursor, limit: 1000 });
      out.push(...r.blobs);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out.map(parseBlob).filter(Boolean);
  }

  storage = {
    list: listAll,
    async add({ buffer, contentType, guestId, ip, guestName }) {
      const rec = {
        id: crypto.randomUUID(),
        guestId,
        ip,
        guestName,
        uploadedAt: Date.now(),
        published: false,
      };
      const ext = EXT_BY_MIME[contentType] || '.jpg';
      const blob = await put(makePathname(rec, ext), buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
      });
      rec.url = blob.url;
      return rec;
    },
    async remove(rec) {
      await del(rec.url);
    },
    async setPublished(rec, published) {
      if (rec.published === !!published) return;
      const ext = path.extname(rec.pathname) || '.jpg';
      const target = makePathname({ ...rec, published: !!published }, ext);
      await copy(rec.url, target, { access: 'public', addRandomSuffix: false });
      await del(rec.url);
    },
  };
} else {
  const DATA_FILE = path.join(__dirname, 'data', 'photos.json');
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const loadAll = () => {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
  };
  const saveAll = (photos) => fs.writeFileSync(DATA_FILE, JSON.stringify(photos, null, 2));

  storage = {
    UPLOADS_DIR,
    async list() {
      return loadAll().map((p) => ({ ...p, url: `/uploads/${p.filename}` }));
    },
    async add({ buffer, contentType, guestId, ip, guestName }) {
      const ext = EXT_BY_MIME[contentType] || '.jpg';
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
      const rec = {
        id: crypto.randomUUID(),
        guestId,
        ip,
        guestName,
        filename,
        uploadedAt: Date.now(),
        published: false,
      };
      const photos = loadAll();
      photos.push(rec);
      saveAll(photos);
      return { ...rec, url: `/uploads/${filename}` };
    },
    async remove(rec) {
      const photos = loadAll();
      const idx = photos.findIndex((p) => p.id === rec.id);
      if (idx !== -1) {
        fs.unlink(path.join(UPLOADS_DIR, photos[idx].filename), () => {});
        photos.splice(idx, 1);
        saveAll(photos);
      }
    },
    async setPublished(rec, published) {
      const photos = loadAll();
      const p = photos.find((x) => x.id === rec.id);
      if (p) { p.published = !!published; saveAll(photos); }
    },
  };
}

/* ==================== вспомогательное ==================== */

function getIp(req) {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// фото «принадлежит» гостю, если совпал его id ИЛИ IP-адрес —
// смена браузера не сбрасывает лимит и не отнимает право удаления
function isOwn(photo, guestId, ip) {
  return (guestId && photo.guestId === guestId) || (ip && photo.ip === ip);
}

/* Админ-токены без состояния (переживают перезапуски serverless-функций):
   token = expiry.hmac(ADMIN_PASSWORD, expiry) */
function makeAdminToken() {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}
function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expect = crypto.createHmac('sha256', ADMIN_PASSWORD).update(exp).digest('hex');
  return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход администратора' });
  next();
}

// обёртка для async-роутов — ошибки уходят в общий обработчик
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

/* ==================== приложение ==================== */

const app = express();
app.set('trust proxy', true); // корректный req.ip за прокси (Vercel, cloudflared)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (storage.UPLOADS_DIR) app.use('/uploads', express.static(storage.UPLOADS_DIR));

app.get('/content.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'content.json'));
});

/* ---------- публичное API ---------- */

app.get('/api/photos/published', ah(async (req, res) => {
  const photos = (await storage.list())
    .filter((p) => p.published)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, url, guestName, uploadedAt }) => ({ id, url, guestName: guestName || '', uploadedAt }));
  res.json(photos);
}));

app.get('/api/photos/mine', ah(async (req, res) => {
  const guestId = req.query.guestId;
  const ip = getIp(req);
  const photos = (await storage.list())
    .filter((p) => isOwn(p, guestId, ip))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, url, published, uploadedAt }) => ({ id, url, published, uploadedAt }));
  res.json({ photos, limit: MAX_PHOTOS_PER_GUEST });
}));

app.post('/api/photos', upload.single('photo'), ah(async (req, res) => {
  const { guestId, guestName } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Файл не получен или это не изображение' });
  if (!guestId) return res.status(400).json({ error: 'Нет идентификатора гостя' });
  const ip = getIp(req);
  // лимит считаем и по guestId, и по IP — смена браузера его не сбрасывает
  const mine = (await storage.list()).filter((p) => isOwn(p, guestId, ip));
  if (mine.length >= MAX_PHOTOS_PER_GUEST) {
    return res.status(403).json({ error: `Лимит ${MAX_PHOTOS_PER_GUEST} фото исчерпан` });
  }
  const rec = await storage.add({
    buffer: req.file.buffer,
    contentType: req.file.mimetype,
    guestId,
    ip,
    guestName: (guestName || '').slice(0, 60),
  });
  res.json({ id: rec.id, url: rec.url, published: false, remaining: MAX_PHOTOS_PER_GUEST - mine.length - 1 });
}));

app.delete('/api/photos/:id', ah(async (req, res) => {
  const photos = await storage.list();
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Фото не найдено' });
  const own = isOwn(photo, req.query.guestId, getIp(req));
  if (!own && !isAdmin(req)) return res.status(403).json({ error: 'Можно удалять только свои фото' });
  await storage.remove(photo);
  res.json({ ok: true });
}));

app.get('/api/qr', ah(async (req, res) => {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = `${proto}://${host}/camera.html`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 640,
    margin: 2,
    color: { dark: '#5c2a33', light: '#fff8f6' },
  });
  res.json({ url, qr: dataUrl });
}));

/* ---------- PDF-постер с QR для печати ---------- */
app.get('/api/qr.pdf', ah(async (req, res) => {
  const PDFDocument = require('pdfkit');
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8'));
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = `${proto}://${host}/camera.html`;

  // A3 портрет; QR рисуем векторными квадратами — при печати в любом
  // размере (хоть баннер 2×3 м) он останется идеально резким
  const W = 841.89, H = 1190.55;
  const ROSE = '#b0495c', ROSE_DEEP = '#8c3547', INK = '#3c2228', SOFT = '#7a5a60', PAPER = '#fdf7f4';

  const doc = new PDFDocument({ size: [W, H], margin: 0 });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="qr-banner.pdf"');
  doc.pipe(res);

  doc.registerFont('serif', path.join(__dirname, 'fonts', 'PTSerif-Regular.ttf'));
  doc.registerFont('serif-bold', path.join(__dirname, 'fonts', 'PTSerif-Bold.ttf'));
  doc.registerFont('serif-italic', path.join(__dirname, 'fonts', 'PTSerif-Italic.ttf'));

  // фон и рамка
  doc.rect(0, 0, W, H).fill(PAPER);
  doc.lineWidth(1.5).roundedRect(36, 36, W - 72, H - 72, 18).stroke(ROSE);
  doc.lineWidth(0.7).roundedRect(46, 46, W - 92, H - 92, 14).stroke('#d9a3ad');

  // шапка
  doc.font('serif-italic').fontSize(20).fillColor(SOFT)
    .text((content.hero && content.hero.eyebrow) || '', 0, 96, { width: W, align: 'center' });
  doc.font('serif-bold').fontSize(56).fillColor(ROSE_DEEP)
    .text((content.meta && content.meta.couple) || '', 0, 128, { width: W, align: 'center' });
  // разделитель
  doc.moveTo(W / 2 - 90, 210).lineTo(W / 2 + 90, 210).lineWidth(1).stroke(ROSE);

  doc.font('serif-bold').fontSize(34).fillColor(INK)
    .text((content.qr && content.qr.title) || 'Поделитесь моментами!', 0, 240, { width: W, align: 'center' });
  doc.font('serif').fontSize(17).fillColor(SOFT)
    .text((content.qr && content.qr.subtitle) || '', W * 0.18, 296, { width: W * 0.64, align: 'center', lineGap: 4 });

  // белая карточка + векторный QR
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const QR_SIZE = 430;
  const cell = QR_SIZE / size;
  const qx = (W - QR_SIZE) / 2;
  const qy = 400;
  doc.roundedRect(qx - 30, qy - 30, QR_SIZE + 60, QR_SIZE + 60, 22).fill('#ffffff');
  doc.lineWidth(1).roundedRect(qx - 30, qy - 30, QR_SIZE + 60, QR_SIZE + 60, 22).stroke('#e8c5cc');
  doc.fillColor('#4a1f28');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.3, cell + 0.3);
    }
  }
  doc.fill('#4a1f28');

  // подсказка и адрес
  doc.font('serif-italic').fontSize(18).fillColor(SOFT)
    .text((content.qr && content.qr.hint) || '', 0, qy + QR_SIZE + 58, { width: W, align: 'center' });
  doc.font('serif').fontSize(15).fillColor(ROSE)
    .text(url, 0, qy + QR_SIZE + 92, { width: W, align: 'center' });

  // рекламный футер
  const fy = H - 132;
  doc.moveTo(W / 2 - 140, fy).lineTo(W / 2 + 140, fy).lineWidth(0.7).stroke('#d9a3ad');
  doc.font('serif').fontSize(13).fillColor(SOFT)
    .text('Хотите такое же пригласительное?', 0, fy + 16, { width: W, align: 'center' });
  doc.font('serif-bold').fontSize(14).fillColor(ROSE_DEEP)
    .text('Telegram @zhtynybek   ·   WhatsApp +996 559 020 199', 0, fy + 38, { width: W, align: 'center' });

  doc.end();
}));

/* ---------- API администратора ---------- */

app.post('/api/admin/login', (req, res) => {
  if ((req.body.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  res.json({ token: makeAdminToken() });
});

app.get('/api/admin/photos', requireAdmin, ah(async (req, res) => {
  const photos = (await storage.list())
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map(({ id, url, guestId, guestName, ip, published, uploadedAt }) => ({
      id, url, guestId, guestName: guestName || '', ip: ip || '', published, uploadedAt,
    }));
  res.json(photos);
}));

app.post('/api/admin/photos/:id/publish', requireAdmin, ah(async (req, res) => {
  const photo = (await storage.list()).find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Фото не найдено' });
  await storage.setPublished(photo, !!req.body.published);
  res.json({ ok: true, published: !!req.body.published });
}));

app.post('/api/admin/photos/publish-all', requireAdmin, ah(async (req, res) => {
  const pending = (await storage.list()).filter((p) => !p.published);
  for (const p of pending) await storage.setPublished(p, true);
  res.json({ ok: true, count: pending.length });
}));

/* ---------- ошибки ---------- */
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.url, err);
  res.status(err.status || 500).json({ error: err.message || 'Ошибка сервера' });
});

module.exports = app;
