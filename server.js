/* Локальный запуск: node server.js (на Vercel вместо этого работает api/index.js) */
const os = require('os');
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  console.log(`Приглашение:  http://localhost:${PORT}`);
  if (lan) console.log(`В локальной сети (для QR): http://${lan.address}:${PORT}`);
  console.log(`Админка:      http://localhost:${PORT}/admin.html`);
});
