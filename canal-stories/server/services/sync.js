// sync.js — 离线收藏：内容/交通双版本快照；重连只替换受影响部分并给出差异；
// 列表、无图阅读、打印路线从同一快照导出；快照永不标注为"实时已核实"。
const crypto = require('crypto');
const placesSvc = require('./places');
const interviewsSvc = require('./interviews');

function buildPayload(db, clientId) {
  const places = db.all('SELECT * FROM places').map(p => placesSvc.placeDetail(db, p.id));
  const events = db.all('SELECT * FROM events ORDER BY event_date').map(e => {
    const loc = placesSvc.eventLocation(db, e.id);
    return { ...e, pinned: loc.pinned_version, current: loc.current_version, moved_since: loc.moved_since };
  });
  const interviews = db.all('SELECT * FROM interviews').map(iv => ({
    ...iv,
    segments: db.all('SELECT * FROM segments WHERE interview_id=? ORDER BY idx', [iv.id]),
    public_track: interviewsSvc.publicTrack(db, iv.id)
  }));
  const routes = db.all('SELECT * FROM routes').map(r => ({ ...r, steps: JSON.parse(r.steps) }));
  const transport = {
    stops: db.all('SELECT * FROM stops'),
    connections: db.all('SELECT * FROM connections'),
    walk_windows: db.all('SELECT * FROM walk_windows'),
    departures: db.all('SELECT * FROM departures'),
    announcements: db.all('SELECT * FROM announcements')
  };
  const favorites = clientId ? db.all('SELECT * FROM favorites WHERE client_id=?', [clientId]) : [];
  return {
    is_live: false,   // 快照永远不自称实时
    generated_at: new Date().toISOString(),
    content_version: db.version('content'), transport_version: db.version('transport'),
    places, events, interviews, routes, transport, favorites
  };
}

function makeSnapshot(db, clientId) {
  const payload = buildPayload(db, clientId);
  const id = crypto.randomUUID();
  db.run('INSERT INTO snapshots(id,client_id,content_version,transport_version,payload) VALUES(?,?,?,?,?)',
    [id, clientId || null, payload.content_version, payload.transport_version, JSON.stringify(payload)]);
  return { snapshot_id: id, ...payload };
}

// 实体当前表示（用于差异替换）
function entityPayload(db, entity, id) {
  switch (entity) {
    case 'place': return placesSvc.placeDetail(db, id);
    case 'event': {
      const e = db.get('SELECT * FROM events WHERE id=?', [id]);
      if (!e) return null;
      const loc = placesSvc.eventLocation(db, id);
      return { ...e, pinned: loc.pinned_version, current: loc.current_version, moved_since: loc.moved_since };
    }
    case 'interview': {
      const iv = db.get('SELECT * FROM interviews WHERE id=?', [id]);
      if (!iv) return null;
      return { ...iv, segments: db.all('SELECT * FROM segments WHERE interview_id=? ORDER BY idx', [id]), public_track: interviewsSvc.publicTrack(db, id) };
    }
    case 'route': { const r = db.get('SELECT * FROM routes WHERE id=?', [id]); return r ? { ...r, steps: JSON.parse(r.steps) } : null; }
    case 'announcement': return db.get('SELECT * FROM announcements WHERE id=?', [id]);
    case 'connection': return db.get('SELECT * FROM connections WHERE id=?', [id]);
    default: return null;
  }
}

// 重连同步：只返回受影响部分 + 受影响的收藏
function sync(db, { client_id, content_version = 0, transport_version = 0, favorites = [] }) {
  // 合并客户端收藏（离线期间新增）
  for (const f of favorites)
    db.run('INSERT OR IGNORE INTO favorites(client_id,entity_type,entity_id) VALUES(?,?,?)',
      [client_id, f.entity_type, f.entity_id]);

  const curC = db.version('content'), curT = db.version('transport');
  const needFull = content_version > curC || transport_version > curT;
  if (needFull) return { full_required: true, snapshot: makeSnapshot(db, client_id) };

  const changes = { content: [], transport: [] };
  for (const domain of ['content', 'transport']) {
    const since = domain === 'content' ? content_version : transport_version;
    const rows = db.all('SELECT * FROM change_log WHERE domain=? AND version>? ORDER BY version', [domain, since]);
    const seen = new Map();
    for (const r of rows) seen.set(`${r.entity}:${r.entity_id}`, r); // 同实体只保留最新
    for (const r of seen.values())
      changes[domain].push({ entity: r.entity, entity_id: r.entity_id, op: r.op, summary: r.summary, version: r.version, data: entityPayload(db, r.entity, r.entity_id) });
  }
  // 受影响收藏：内容变更精确匹配；交通变更影响所有路线类收藏
  const favs = db.all('SELECT * FROM favorites WHERE client_id=?', [client_id]);
  const affected = [];
  for (const f of favs) {
    const hit = changes.content.find(c => c.entity === f.entity_type && c.entity_id === f.entity_id);
    const transportHit = f.entity_type === 'route' && changes.transport.length > 0;
    if (hit) affected.push({ ...f, reason: hit.summary });
    else if (transportHit) affected.push({ ...f, reason: '交通数据更新，路线需重算' });
  }
  return {
    full_required: false,
    content_version: curC, transport_version: curT,
    changes, affected_favorites: affected,
    favorites: favs,
    is_live: false, note: '差异基于服务器变更日志生成；请替换受影响部分后重新生成快照用于导出'
  };
}

function getSnapshot(db, id) {
  const row = db.get('SELECT * FROM snapshots WHERE id=?', [id]);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) };
}

module.exports = { makeSnapshot, sync, getSnapshot, buildPayload };
