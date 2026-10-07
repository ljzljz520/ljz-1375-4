// index.js — 服务器入口
const path = require('path');
const express = require('express');
const { openDatabase } = require('./db');
const seed = require('./seed');

async function createApp(dbFile) {
  const db = await openDatabase(dbFile);
  if (db.get('SELECT COUNT(*) AS n FROM places').n === 0) seed(db);
  const app = express();
  app.use(express.json());
  app.use('/api', require('./routes/api')(db));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return { app, db };
}

if (require.main === module) {
  const port = +(process.env.PORT || 3000);
  const dbFile = process.env.DB || require('path').join(__dirname, '..', 'data', 'canal.db');
  createApp(dbFile).then(({ app }) => {
    app.listen(port, () => console.log(`运河船工故事站 → http://localhost:${port}`));
  });
}
module.exports = { createApp };
