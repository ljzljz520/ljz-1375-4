// db.js — sql.js (WASM SQLite) 持久化层
// 双版本号: content_version(内容) / transport_version(交通)，所有变更写入 change_log 以支持离线差异同步
const initSqlJs = require('sql.js');
const fs = require('fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS places(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- dock|lock|granary|home
  status TEXT NOT NULL DEFAULT 'active',  -- active|submerged|demolished|pending_location
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS place_versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  lat REAL, lng REAL,               -- NULL => 待定位
  valid_from INTEGER NOT NULL,      -- 起始年
  valid_to INTEGER,                 -- NULL => 至今
  change_type TEXT NOT NULL DEFAULT 'found', -- found|rename|relocate|submerge|restore
  note TEXT DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'approved', -- approved|pending|rejected
  superseded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 可审阅关联：更名链 / 迁建 / 淹没 / 同名异址
CREATE TABLE IF NOT EXISTS place_links(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_place INTEGER NOT NULL, to_place INTEGER NOT NULL,
  type TEXT NOT NULL,               -- rename_chain|relocated_to|same_name_different_site|submerged_site_of
  note TEXT DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  action TEXT NOT NULL, actor TEXT DEFAULT 'editor', note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 事件钉住 place_version_id：此后道路改线/迁建不会改变旧事件位置
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, description TEXT DEFAULT '',
  event_date TEXT NOT NULL,
  place_id INTEGER NOT NULL,
  place_version_id INTEGER NOT NULL,
  family TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stops(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, lat REAL, lng REAL, place_id INTEGER
);
CREATE TABLE IF NOT EXISTS connections(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_stop INTEGER NOT NULL, to_stop INTEGER NOT NULL,
  mode TEXT NOT NULL,               -- walk|boat|ferry
  duration_min INTEGER NOT NULL, distance_m INTEGER DEFAULT 0,
  bidirectional INTEGER DEFAULT 1
);
-- 步行/船行开放窗口（每日，分钟制；close 可为 1440）
CREATE TABLE IF NOT EXISTS walk_windows(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL, open_min INTEGER NOT NULL, close_min INTEGER NOT NULL
);
-- 渡口班次（每日，depart_min 0..1439；到达可跨午夜）
CREATE TABLE IF NOT EXISTS departures(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL, depart_min INTEGER NOT NULL
);
-- 公告：船闸临时关闭等
CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, body TEXT DEFAULT '',
  scope_type TEXT NOT NULL, scope_id INTEGER NOT NULL,  -- connection|stop
  effect TEXT NOT NULL DEFAULT 'closed',                -- closed|info
  starts_min INTEGER NOT NULL, ends_min INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT DEFAULT '',
  from_stop INTEGER, to_stop INTEGER,
  steps TEXT NOT NULL DEFAULT '[]'  -- [{connection_id, planned_depart_min}]
);

CREATE TABLE IF NOT EXISTS interviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, interviewee TEXT DEFAULT '', family TEXT DEFAULT '',
  place_id INTEGER, recorded_at TEXT DEFAULT '',
  av_offset_ms INTEGER NOT NULL DEFAULT 0   -- 音画偏移：>0 表示音频滞后
);
CREATE TABLE IF NOT EXISTS segments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL, idx INTEGER NOT NULL,
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  license TEXT NOT NULL DEFAULT 'public',   -- public|family_only|restricted
  label TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cues(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL, offset_ms INTEGER NOT NULL, text TEXT NOT NULL
);
-- 剪辑：保留区间列表（源媒体时码）
CREATE TABLE IF NOT EXISTS edits(
  interview_id INTEGER PRIMARY KEY,
  ranges TEXT NOT NULL DEFAULT '[]',        -- [{segment_id,start_ms,end_ms}]
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,             -- content|transport
  version INTEGER NOT NULL,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  op TEXT NOT NULL,                 -- upsert|delete
  summary TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites(
  client_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(client_id, entity_type, entity_id)
);

-- 快照：列表/无图阅读/打印路线全部从同一快照导出，且永不标注为实时
CREATE TABLE IF NOT EXISTS snapshots(
  id TEXT PRIMARY KEY, client_id TEXT,
  content_version INTEGER NOT NULL, transport_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

let SQLPromise = null;
async function openDatabase(file) {
  if (!SQLPromise) SQLPromise = initSqlJs();
  const SQL = await SQLPromise;
  let db;
  if (file && fs.existsSync(file)) db = new SQL.Database(fs.readFileSync(file));
  else db = new SQL.Database();
  db.run(SCHEMA);

  const api = {
    file, db,
    all(sql, params = []) {
      const stmt = db.prepare(sql);
      try { stmt.bind(params); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
      finally { stmt.free(); }
    },
    get(sql, params = []) { return api.all(sql, params)[0] || null; },
    run(sql, params = []) {
      const stmt = db.prepare(sql);
      try { stmt.bind(params); stmt.step(); } finally { stmt.free(); }
      const id = api.get('SELECT last_insert_rowid() AS id').id;
      api.scheduleSave();
      return id;
    },
    scheduleSave() {
      if (!file) return;
      if (api._t) return;
      api._t = setTimeout(() => { api._t = null; api.saveNow(); }, 200);
    },
    saveNow() {
      if (!file) return;
      fs.writeFileSync(file, Buffer.from(db.export()));
    },
    version(domain) {
      const r = api.get('SELECT value FROM meta WHERE key=?', [domain + '_version']);
      return r ? r.value : 0;
    },
    bump(domain) {
      const key = domain + '_version';
      const v = api.version(domain) + 1;
      api.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, v]);
      return v;
    },
    logChange(domain, entity, entityId, op, summary = '') {
      const v = api.bump(domain);
      api.run('INSERT INTO change_log(domain,version,entity,entity_id,op,summary) VALUES(?,?,?,?,?,?)',
        [domain, v, entity, entityId, op, summary]);
      return v;
    },
    close() { api.saveNow(); db.close(); }
  };
  return api;
}

module.exports = { openDatabase };
