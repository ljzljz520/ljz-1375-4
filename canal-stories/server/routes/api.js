// api.js — REST API
const express = require('express');
const places = require('../services/places');
const transport = require('../services/transport');
const interviews = require('../services/interviews');
const sync = require('../services/sync');

module.exports = function api(db) {
  const r = express.Router();
  const ah = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  r.get('/health', (req, res) => res.json({ ok: true, content_version: db.version('content'), transport_version: db.version('transport') }));

  // ---- 地点身份与版本 ----
  r.get('/places', ah((req, res) => res.json(db.all('SELECT * FROM places').map(p => places.placeDetail(db, p.id)))));
  r.get('/places/pending-location', ah((req, res) => res.json(places.pendingLocation(db))));
  r.get('/places/:id', ah((req, res) => {
    const d = places.placeDetail(db, +req.params.id);
    d ? res.json(d) : res.status(404).json({ error: 'not found' });
  }));
  r.post('/places', ah((req, res) => res.json({ id: places.createPlace(db, req.body) })));
  r.post('/places/:id/versions', ah((req, res) => res.json({ id: places.addVersion(db, +req.params.id, req.body) })));
  r.post('/places/links', ah((req, res) => res.json({ id: places.linkSameName(db, req.body.from_place, req.body.to_place, req.body.note) })));

  // ---- 审阅 ----
  r.get('/review/pending', ah((req, res) => res.json({
    links: db.all("SELECT * FROM place_links WHERE review_status='pending'"),
    versions: db.all("SELECT * FROM place_versions WHERE review_status='pending'"),
    log: db.all('SELECT * FROM review_log ORDER BY id DESC LIMIT 50')
  })));
  r.post('/review/links/:id', ah((req, res) => res.json(places.review(db, 'link', +req.params.id, req.body.action, req.body.actor, req.body.note))));
  r.post('/review/versions/:id', ah((req, res) => res.json(places.review(db, 'version', +req.params.id, req.body.action, req.body.actor, req.body.note))));

  // ---- 事件 / 时间轴 ----
  r.get('/events', ah((req, res) => res.json(db.all('SELECT * FROM events ORDER BY event_date').map(e => ({ ...e, location: places.eventLocation(db, e.id) })))));
  r.post('/events', ah((req, res) => res.json({ id: places.createEvent(db, req.body) })));
  r.get('/events/:id/location', ah((req, res) => res.json(places.eventLocation(db, +req.params.id))));

  // ---- 交通网络 ----
  r.get('/transport', ah((req, res) => res.json({
    transport_version: db.version('transport'),
    stops: db.all('SELECT * FROM stops'),
    connections: db.all('SELECT * FROM connections'),
    walk_windows: db.all('SELECT * FROM walk_windows'),
    departures: db.all('SELECT * FROM departures'),
    announcements: db.all('SELECT * FROM announcements')
  })));
  r.post('/transport/announcements', ah((req, res) => {
    const id = db.run('INSERT INTO announcements(title,body,scope_type,scope_id,effect,starts_min,ends_min) VALUES(?,?,?,?,?,?,?)',
      [req.body.title, req.body.body || '', req.body.scope_type, req.body.scope_id, req.body.effect || 'closed', req.body.starts_min, req.body.ends_min]);
    db.logChange('transport', 'announcement', id, 'upsert', `公告「${req.body.title}」`);
    res.json({ id, transport_version: db.version('transport') });
  }));
  r.delete('/transport/announcements/:id', ah((req, res) => {
    db.run('DELETE FROM announcements WHERE id=?', [+req.params.id]);
    db.logChange('transport', 'announcement', +req.params.id, 'delete', '公告解除');
    res.json({ ok: true, transport_version: db.version('transport') });
  }));

  // ---- 动态最早到达搜索（支持 debug_delay_ms 模拟查询期间公告更新）----
  r.get('/search', ah(async (req, res) => {
    const v0 = db.version('transport');
    const delay = +req.query.debug_delay_ms || 0;
    if (delay) await sleep(delay);
    const result = transport.earliestArrival(db, +req.query.from, +req.query.to, +req.query.start_min);
    const v1 = db.version('transport');
    res.json({ ...result, transport_version_at_start: v0, transport_version: v1, stale: v1 !== v0,
      stale_note: v1 !== v0 ? '查询期间交通公告已更新，结果基于查询开始时的版本，请重新查询' : null });
  }));

  // ---- 预制路线：检查 + 与动态搜索对比 ----
  r.get('/routes', ah((req, res) => res.json(db.all('SELECT * FROM routes').map(x => ({ ...x, steps: JSON.parse(x.steps) })))));
  r.post('/routes', ah((req, res) => {
    const id = db.run('INSERT INTO routes(name,description,from_stop,to_stop,steps) VALUES(?,?,?,?,?)',
      [req.body.name, req.body.description || '', req.body.from_stop, req.body.to_stop, JSON.stringify(req.body.steps || [])]);
    db.logChange('content', 'route', id, 'upsert', `新增路线「${req.body.name}」`);
    res.json({ id });
  }));
  r.get('/routes/:id/check', ah(async (req, res) => {
    const route = db.get('SELECT * FROM routes WHERE id=?', [+req.params.id]);
    if (!route) return res.status(404).json({ error: 'route not found' });
    const startMin = +(req.query.start_min ?? 480);
    const v0 = db.version('transport');
    const delay = +req.query.debug_delay_ms || 0;
    if (delay) await sleep(delay);
    const prebuilt = transport.checkPrebuiltRoute(db, route, startMin);
    const dynamic = transport.earliestArrival(db, route.from_stop, route.to_stop, startMin);
    const v1 = db.version('transport');
    res.json({
      route: { ...route, steps: JSON.parse(route.steps) }, start_min: startMin,
      prebuilt, dynamic,
      comparison: (prebuilt.feasible && dynamic.reachable) ? {
        delta_min: prebuilt.arrival_min - dynamic.arrival_min,
        note: prebuilt.arrival_min <= dynamic.arrival_min ? '预制路线不劣于动态搜索' : `动态搜索可早到 ${prebuilt.arrival_min - dynamic.arrival_min} 分钟`
      } : { note: !prebuilt.feasible ? '预制路线当前不可行，动态结果可作为替代' : '动态搜索亦不可达' },
      transport_version_at_start: v0, transport_version: v1, stale: v1 !== v0,
      stale_note: v1 !== v0 ? '查询期间交通公告已更新，本结果基于查询开始时的版本' : null
    });
  }));

  // ---- 访谈 ----
  r.get('/interviews', ah((req, res) => res.json(db.all('SELECT * FROM interviews').map(iv => ({
    ...iv, segments: db.all('SELECT * FROM segments WHERE interview_id=? ORDER BY idx', [iv.id])
  })))));
  r.get('/interviews/:id/public-track', ah((req, res) => res.json(interviews.publicTrack(db, +req.params.id))));
  r.put('/interviews/:id/edit', ah((req, res) => res.json(interviews.setEdit(db, +req.params.id, req.body.ranges))));
  r.put('/interviews/:id/av-offset', ah((req, res) => res.json(interviews.setAvOffset(db, +req.params.id, +req.body.av_offset_ms))));
  r.put('/segments/:id/license', ah((req, res) => res.json(interviews.setLicense(db, +req.params.id, req.body.license))));

  // ---- 快照 / 同步 / 收藏 ----
  r.get('/snapshot', ah((req, res) => res.json(sync.makeSnapshot(db, req.query.client_id || 'anon'))));
  r.post('/sync', ah((req, res) => res.json(sync.sync(db, req.body))));

  // ---- 导出：全部从同一快照读取 ----
  const snapOr404 = (req, res) => {
    const s = sync.getSnapshot(db, req.query.snapshot_id);
    if (!s) { res.status(404).send('快照不存在'); return null; }
    return s;
  };
  const banner = s => `<p class="snap">快照 #${s.id.slice(0, 8)} · 内容 v${s.content_version} / 交通 v${s.transport_version} · 生成于 ${s.created_at} · <b>非实时数据，开放状态以现场公告为准</b></p>`;
  const css = '<style>body{font-family:serif;max-width:720px;margin:2em auto}.snap{background:#fff3cd;padding:.5em;border:1px solid #e0c36d}h1{font-size:1.4em}li{margin:.3em 0}</style>';

  r.get('/export/list', ah((req, res) => {
    const s = snapOr404(req, res); if (!s) return;
    const items = s.payload.events.map(e => `<li>${e.event_date} · ${e.title}（${e.pinned ? e.pinned.name : '地点未知'}）</li>`).join('');
    res.send(`<!doctype html><meta charset="utf-8">${css}<h1>运河船工故事 · 事件列表</h1>${banner(s)}<ul>${items}</ul>`);
  }));
  r.get('/export/text', ah((req, res) => {
    const s = snapOr404(req, res); if (!s) return;
    const body = s.payload.interviews.map(iv =>
      `<h2>${iv.title}（${iv.interviewee}）</h2><p>${iv.public_track.cues.map(c => `[${c.track_time}] ${c.text}`).join('<br>')}</p>`).join('');
    res.send(`<!doctype html><meta charset="utf-8">${css}<h1>无图阅读 · 访谈逐字稿</h1>${banner(s)}${body}`);
  }));
  r.get('/export/route/:id', ah((req, res) => {
    const s = snapOr404(req, res); if (!s) return;
    const route = s.payload.routes.find(x => x.id === +req.params.id);
    if (!route) return res.status(404).send('快照中无此路线');
    const stops = Object.fromEntries(s.payload.transport.stops.map(x => [x.id, x]));
    const conns = Object.fromEntries(s.payload.transport.connections.map(x => [x.id, x]));
    const rows = route.steps.map((st, i) => {
      const c = conns[st.connection_id];
      return c ? `<li>第${i + 1}段：${stops[c.from_stop]?.name} → ${stops[c.to_stop]?.name}（${c.mode}，约${c.duration_min}分钟${st.planned_depart_min != null ? `，计划 ${transport.fmt(st.planned_depart_min)} 出发` : ''}）</li>` : '';
    }).join('');
    res.send(`<!doctype html><meta charset="utf-8">${css}<h1>打印路线 · ${route.name}</h1>${banner(s)}<ol>${rows}</ol><p>打印时间以快照为准，出行前请核对当日公告。</p>`);
  }));

  return r;
};
