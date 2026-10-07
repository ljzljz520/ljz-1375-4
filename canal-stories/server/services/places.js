// places.js — 历史地点身份持久化：更名/迁建/淹没/同名异址 全部建模为
// 「身份(place) + 版本(place_version) + 可审阅关联(place_link)」。
// 事件创建时钉住当时版本；之后道路改线/迁建只新增版本，绝不改写旧事件位置。
function versionAt(db, placeId, year) {
  return db.get(
    `SELECT * FROM place_versions WHERE place_id=? AND valid_from<=?
       AND (valid_to IS NULL OR valid_to>?) AND review_status='approved'
     ORDER BY valid_from DESC LIMIT 1`, [placeId, year, year]);
}
function currentVersion(db, placeId) {
  return db.get(
    `SELECT * FROM place_versions WHERE place_id=? AND valid_to IS NULL AND review_status='approved'
     ORDER BY valid_from DESC LIMIT 1`, [placeId]);
}

function createPlace(db, { kind, name, lat = null, lng = null, valid_from, note = '' }) {
  const status = (lat == null || lng == null) ? 'pending_location' : 'active';
  const pid = db.run('INSERT INTO places(kind,status) VALUES(?,?)', [kind, status]);
  db.run(`INSERT INTO place_versions(place_id,name,lat,lng,valid_from,change_type,note)
          VALUES(?,?,?,?,?,'found',?)`, [pid, name, lat, lng, valid_from, note]);
  db.logChange('content', 'place', pid, 'upsert', `新增地点「${name}」`);
  return pid;
}

// 更名/迁建/淹没/恢复：新增版本并生成待审阅关联
function addVersion(db, placeId, { name, lat, lng, valid_from, change_type, note = '' }) {
  const place = db.get('SELECT * FROM places WHERE id=?', [placeId]);
  if (!place) throw new Error('place not found');
  const cur = currentVersion(db, placeId);
  const vid = db.run(
    `INSERT INTO place_versions(place_id,name,lat,lng,valid_from,change_type,note,review_status)
     VALUES(?,?,?,?,?,?,?,'pending')`,
    [placeId, name ?? cur?.name, lat ?? null, lng ?? null, valid_from, change_type, note]);
  if (cur) db.run('UPDATE place_versions SET valid_to=?, superseded_by=? WHERE id=?', [valid_from, vid, cur.id]);
  // 自动生成可审阅关联
  const linkType = { rename: 'rename_chain', relocate: 'relocated_to', submerge: 'submerged_site_of', restore: 'rename_chain' }[change_type];
  if (linkType && cur) {
    db.run(`INSERT INTO place_links(from_place,to_place,type,note,review_status)
            VALUES(?,?,?,?,'pending')`, [placeId, placeId, linkType,
      `${change_type}: 「${cur.name}」→「${name ?? cur.name}」(${note})`]);
  }
  if (change_type === 'submerge') db.run('UPDATE places SET status=? WHERE id=?', ['submerged', placeId]);
  else if (lat != null && lng != null && place.status === 'pending_location')
    db.run('UPDATE places SET status=? WHERE id=?', ['active', placeId]);
  db.logChange('content', 'place', placeId, 'upsert',
    `地点「${cur?.name ?? placeId}」新增版本(${change_type})，待审阅`);
  return vid;
}

function linkSameName(db, fromPlace, toPlace, note = '') {
  const id = db.run(
    `INSERT INTO place_links(from_place,to_place,type,note,review_status)
     VALUES(?,?,?,'same_name_different_site','pending')`, [fromPlace, toPlace, note]);
  db.logChange('content', 'place', fromPlace, 'upsert', `同名异址关联待审阅 #${id}`);
  return id;
}

function review(db, entity, id, action, actor = 'editor', note = '') {
  const table = entity === 'link' ? 'place_links' : 'place_versions';
  const row = db.get(`SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!row) throw new Error(`${entity} ${id} not found`);
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.run(`UPDATE ${table} SET review_status=? WHERE id=?`, [status, id]);
  db.run('INSERT INTO review_log(entity,entity_id,action,actor,note) VALUES(?,?,?,?,?)',
    [entity, id, action, actor, note]);
  db.logChange('content', 'place', row.place_id ?? row.from_place, 'upsert',
    `审阅 ${entity}#${id}: ${action}`);
  return { id, review_status: status };
}

// 事件：钉住事件日期所对应的历史版本
function createEvent(db, { title, description = '', event_date, place_id, family = '' }) {
  const year = new Date(event_date).getFullYear();
  const v = versionAt(db, place_id, year) || currentVersion(db, place_id)
    || db.get('SELECT * FROM place_versions WHERE place_id=? ORDER BY valid_from LIMIT 1', [place_id]);
  if (!v) throw new Error('该地点没有任何版本，无法钉住事件位置');
  const id = db.run(
    'INSERT INTO events(title,description,event_date,place_id,place_version_id,family) VALUES(?,?,?,?,?,?)',
    [title, description, event_date, place_id, v.id, family]);
  db.logChange('content', 'event', id, 'upsert', `新增事件「${title}」`);
  return id;
}

// 事件位置 = 钉住版本的位置；同时返回当前版本以便前端对比（道路改线不影响旧事件）
function eventLocation(db, eventId) {
  const e = db.get('SELECT * FROM events WHERE id=?', [eventId]);
  if (!e) return null;
  const pinned = db.get('SELECT * FROM place_versions WHERE id=?', [e.place_version_id]);
  const current = currentVersion(db, e.place_id);
  return {
    event_id: eventId, pinned_version: pinned, current_version: current,
    moved_since: !!(current && pinned && (current.lat !== pinned.lat || current.lng !== pinned.lng || current.name !== pinned.name))
  };
}

function placeDetail(db, id) {
  const place = db.get('SELECT * FROM places WHERE id=?', [id]);
  if (!place) return null;
  const versions = db.all('SELECT * FROM place_versions WHERE place_id=? ORDER BY valid_from', [id]);
  const links = db.all('SELECT * FROM place_links WHERE from_place=? OR to_place=? ORDER BY id', [id, id]);
  const events = db.all('SELECT * FROM events WHERE place_id=? ORDER BY event_date', [id]);
  return { ...place, versions, links, events, current: currentVersion(db, id) };
}

function pendingLocation(db) {
  return db.all(`SELECT p.*, v.name FROM places p
    LEFT JOIN place_versions v ON v.place_id=p.id AND v.valid_to IS NULL
    WHERE p.status='pending_location' OR (v.lat IS NULL OR v.lng IS NULL)`);
}

module.exports = { createPlace, addVersion, linkSameName, review, createEvent, eventLocation, placeDetail, pendingLocation, currentVersion, versionAt };
