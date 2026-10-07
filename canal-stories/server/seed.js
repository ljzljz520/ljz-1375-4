// seed.js — 清澜运河示例数据
module.exports = function seed(db) {
  const places = require('./services/places');
  const interviews = require('./services/interviews');

  // ---- 地点与历史版本 ----
  // P1 盐仓码头：1932 始建 → 1978 更名 → 1996 东迁 300 米
  const p1 = places.createPlace(db, { kind: 'dock', name: '盐仓码头', lat: 31.2300, lng: 121.4700, valid_from: 1932, note: '始建，盐运集散' });
  places.addVersion(db, p1, { name: '老盐仓码头', valid_from: 1978, change_type: 'rename', note: '新港启用后民间改称' });
  places.addVersion(db, p1, { name: '老盐仓码头', lat: 31.2320, lng: 121.4740, valid_from: 1996, change_type: 'relocate', note: '码头东迁 300 米，原址改滨河步道' });
  // P2 青龙闸
  const p2 = places.createPlace(db, { kind: 'lock', name: '青龙闸', lat: 31.2280, lng: 121.4720, valid_from: 1958, note: '单线船闸' });
  // P3 南门粮仓：1949 建 → 1986 水库蓄水淹没
  const p3 = places.createPlace(db, { kind: 'granary', name: '南门粮仓', lat: 31.2260, lng: 121.4730, valid_from: 1949, note: '苏式仓房' });
  places.addVersion(db, p3, { name: '南门粮仓', valid_from: 1986, change_type: 'submerge', note: '青澜水库蓄水，仓址淹没，仅留岸线纪念点' });
  // P4/P5 渡口巷码头：同名异址
  const p4 = places.createPlace(db, { kind: 'dock', name: '渡口巷码头', lat: 31.2240, lng: 121.4710, valid_from: 1900, note: '老渡口，1975 年废弃' });
  db.run("UPDATE places SET status='demolished' WHERE id=?", [p4]);
  const p5 = places.createPlace(db, { kind: 'dock', name: '渡口巷码头', lat: 31.2250, lng: 121.4690, valid_from: 1975, note: '新址候船室' });
  places.linkSameName(db, p4, p5, '新旧渡口巷码头同名异址，相距约 220 米');
  // P6 陈家老宅
  const p6 = places.createPlace(db, { kind: 'home', name: '陈家老宅', lat: 31.2230, lng: 121.4680, valid_from: 1920, note: '船工世家' });
  // P7 待定位：老辈口中的无名滩涂码头
  const p7 = places.createPlace(db, { kind: 'dock', name: '无名滩涂码头', valid_from: 1930, note: '仅见口述记录，位置待考证' });

  // 审阅：批准 P1 的版本链与 P3 淹没（其余保留待审，供审阅页演示）
  const pendV = db.all("SELECT id FROM place_versions WHERE review_status='pending'");
  pendV.forEach(v => places.review(db, 'version', v.id, 'approve', 'seed', '初始数据核准'));
  const pendL = db.all("SELECT id FROM place_links WHERE review_status='pending' AND type!='same_name_different_site'");
  pendL.forEach(l => places.review(db, 'link', l.id, 'approve', 'seed', '初始数据核准'));

  // ---- 事件（钉住当时版本）----
  const e1 = places.createEvent(db, { title: '陈满仓在盐仓码头扛包谋生', description: '陈家第一代船工上岸打工。', event_date: '1952-04-18', place_id: p1, family: '陈家' });
  places.createEvent(db, { title: '青龙闸大修，船队排队三日', description: '闸室更换木门。', event_date: '1961-09-02', place_id: p2, family: '陆家' });
  const e3 = places.createEvent(db, { title: '渡口巷码头夜渡加开', description: '夏收季节增开夜班摆渡。', event_date: '1979-06-15', place_id: p4, family: '陈家' });
  places.createEvent(db, { title: '南门粮仓最后一批粮食外运', description: '蓄水前抢运。', event_date: '1985-08-30', place_id: p3, family: '陆家' });
  places.createEvent(db, { title: '新盐仓码头启用典礼', description: '东迁后首船靠泊。', event_date: '1998-11-03', place_id: p1, family: '' });
  places.createEvent(db, { title: '渡口巷新码头候船室建成', event_date: '2003-05-20', place_id: p5, family: '' });

  // ---- 交通网络 ----
  const S = {};
  const mkStop = (name, lat, lng, place_id) => { S[name] = db.run('INSERT INTO stops(name,lat,lng,place_id) VALUES(?,?,?,?)', [name, lat, lng, place_id]); };
  mkStop('老盐仓码头', 31.2320, 121.4740, p1);
  mkStop('青龙闸', 31.2280, 121.4720, p2);
  mkStop('南门粮仓纪念点', 31.2260, 121.4730, p3);
  mkStop('渡口巷码头(新)', 31.2250, 121.4690, p5);
  mkStop('陈家村', 31.2230, 121.4680, p6);
  mkStop('老渡口遗址', 31.2240, 121.4710, p4);
  mkStop('北岸集散点', 31.2275, 121.4700, null);

  const conn = (a, b, mode, dur, dist) => db.run('INSERT INTO connections(from_stop,to_stop,mode,duration_min,distance_m) VALUES(?,?,?,?,?)', [S[a], S[b], mode, dur, dist]);
  const win = (cid, o, c) => db.run('INSERT INTO walk_windows(connection_id,open_min,close_min) VALUES(?,?,?)', [cid, o, c]);
  const dep = (cid, m) => db.run('INSERT INTO departures(connection_id,depart_min) VALUES(?,?)', [cid, m]);

  const c1 = conn('老盐仓码头', '青龙闸', 'walk', 15, 900); win(c1, 360, 1320);            // 06:00–22:00
  const c2 = conn('青龙闸', '南门粮仓纪念点', 'walk', 10, 600); win(c2, 0, 1440);            // 全天
  const c3 = conn('青龙闸', '渡口巷码头(新)', 'boat', 20, 1500); win(c3, 330, 1380);         // 过闸船 05:30–23:00
  const c4 = conn('渡口巷码头(新)', '陈家村', 'walk', 25, 1600); win(c4, 0, 1440);
  const c5 = conn('陈家村', '老渡口遗址', 'walk', 18, 1100); win(c5, 0, 1440);
  const c6 = conn('南门粮仓纪念点', '渡口巷码头(新)', 'walk', 12, 750); win(c6, 0, 1440);
  const c7 = conn('老渡口遗址', '北岸集散点', 'ferry', 22, 400);                             // 摆渡 22 分钟
  [330, 480, 720, 960, 1200, 1320, 1430].forEach(m => dep(c7, m));                            // 05:30…末班 23:50，到岸次日 00:12

  // ---- 预制路线：访祖夜渡线（末班跨午夜）----
  const r1 = db.run(`INSERT INTO routes(name,description,from_stop,to_stop,steps) VALUES(?,?,?,?,?)`,
    ['访祖夜渡线', '盐仓码头出发，过闸、访陈家村，末班摆渡过河。', S['老盐仓码头'], S['北岸集散点'],
     JSON.stringify([
       { connection_id: c1 },
       { connection_id: c3, planned_depart_min: 1275 },   // 计划 21:15 过闸
       { connection_id: c4 },
       { connection_id: c5 },
       { connection_id: c7, planned_depart_min: 1430 }    // 计划 23:50 末班摆渡
     ])]);
  db.logChange('content', 'route', r1, 'upsert', '新增路线「访祖夜渡线」');

  // ---- 访谈 ----
  const i1 = db.run(`INSERT INTO interviews(title,interviewee,family,place_id,recorded_at,av_offset_ms)
    VALUES('闸上过夜','陈满仓','陈家',?,'2019-04-12',0)`, [p2]);
  const s1 = db.run(`INSERT INTO segments(interview_id,idx,start_ms,end_ms,license,label) VALUES(?,?,?,?,?,'开场自述')`, [i1, 0, 0, 62000, 'public']);
  const s2 = db.run(`INSERT INTO segments(interview_id,idx,start_ms,end_ms,license,label) VALUES(?,?,?,?,?,'家事（家属限定）')`, [i1, 1, 62000, 151000, 'family_only']);
  const s3 = db.run(`INSERT INTO segments(interview_id,idx,start_ms,end_ms,license,label) VALUES(?,?,?,?,?,'夜渡与末班船')`, [i1, 2, 151000, 233000, 'public']);
  const cue = (sid, off, text) => db.run('INSERT INTO cues(segment_id,offset_ms,text) VALUES(?,?,?)', [sid, off, text]);
  cue(s1, 1200, '我叫陈满仓，一九三八年生。');
  cue(s1, 15000, '十五岁上船，第一趟就是过青龙闸。');
  cue(s1, 44000, '那时候闸上灯少，夜里全靠喊号子。');
  cue(s2, 3000, '（家事段落，经家属同意前不公开）');
  cue(s3, 2000, '末班摆渡二十三点五十分，误了就得在闸口等到天亮。');
  cue(s3, 41000, '有一回为了赶末班，船帮子都蹭掉一层皮。');

  const i2 = db.run(`INSERT INTO interviews(title,interviewee,family,place_id,recorded_at,av_offset_ms)
    VALUES('粮仓的夏天','陆秀珍','陆家',?,'2021-07-03',0)`, [p3]);
  const s4 = db.run(`INSERT INTO segments(interview_id,idx,start_ms,end_ms,license,label) VALUES(?,?,?,?,?,'仓房记忆')`, [i2, 0, 0, 95000, 'public']);
  const s5 = db.run(`INSERT INTO segments(interview_id,idx,start_ms,end_ms,license,label) VALUES(?,?,?,?,?,'蓄水那年')`, [i2, 1, 95000, 180000, 'public']);
  cue(s4, 2500, '南门粮仓的仓房是苏式的，夏天里面比外头凉快。');
  cue(s4, 52000, '运粮的船一进闸，全码头都听得见号子。');
  cue(s5, 8000, '八五年八月最后一批粮运出去，第二年就蓄水了。');

  // ---- 收藏（演示客户端）----
  const fav = (t, id) => db.run('INSERT OR IGNORE INTO favorites(client_id,entity_type,entity_id) VALUES(?,?,?)', ['demo', t, id]);
  fav('place', p1); fav('event', e3); fav('interview', i1); fav('route', r1);

  db.saveNow();
  console.log('seed 完成');
};
