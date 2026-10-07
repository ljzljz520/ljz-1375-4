// transport.js — 时间依赖交通图：步行/渡口时间窗口、跨午夜班次、
// 动态最早到达搜索（time-dependent Dijkstra）、预制路线检查与错过换乘解释
const DAY = 1440;
const fmt = (min) => {
  if (min == null) return '—';
  const day = Math.floor(min / DAY), m = min % DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  return (day === 0 ? '' : '次日'.repeat(day === 1 ? 1 : 0) || `第${day + 1}日`) + `${hh}:${mm}`;
};

function loadNetwork(db) {
  const connections = db.all('SELECT * FROM connections');
  const windows = db.all('SELECT * FROM walk_windows');
  const departures = db.all('SELECT * FROM departures');
  const announcements = db.all('SELECT * FROM announcements');
  const stops = {};
  db.all('SELECT * FROM stops').forEach(s => stops[s.id] = s);
  const byConn = {};
  for (const c of connections) byConn[c.id] = { ...c, windows: [], departures: [], closures: [] };
  for (const w of windows) byConn[w.connection_id] && byConn[w.connection_id].windows.push(w);
  for (const d of departures) byConn[d.connection_id] && byConn[d.connection_id].departures.push(d.depart_min);
  for (const c of connections) byConn[c.id].departures.sort((a, b) => a - b);
  for (const a of announcements) {
    if (a.effect === 'closed' && a.scope_type === 'connection' && byConn[a.scope_id])
      byConn[a.scope_id].closures.push(a);
  }
  return { connections: byConn, stops, announcements };
}

const closedAt = (conn, t) => conn.closures.find(a => t >= a.starts_min && t < a.ends_min) || null;

// 步行/船行：下一可进入时刻（落在开放窗口且未被公告关闭）
function nextOpenDeparture(conn, t, horizon = 3 * DAY) {
  for (let k = 0; k * DAY <= horizon; k++) {
    for (const w of conn.windows) {
      const open = w.open_min + k * DAY, close = w.close_min + k * DAY;
      const dep = Math.max(t, open);
      if (dep < close && !closedAt(conn, dep)) return dep;
    }
  }
  return null;
}

// 渡口：下一班次（每日循环，可跨午夜）
function nextFerryDeparture(conn, t, horizon = 3 * DAY) {
  let best = null;
  for (const d of conn.departures) {
    let k = Math.ceil((t - d) / DAY); if (k < 0) k = 0;
    const dep = d + k * DAY;
    if (dep >= t && dep <= t + horizon && !closedAt(conn, dep) && (best === null || dep < best)) best = dep;
  }
  return best;
}

function nextDeparture(conn, t, horizon) {
  if (conn.mode === 'ferry') return nextFerryDeparture(conn, t, horizon);
  return nextOpenDeparture(conn, t, horizon);
}

// 动态最早到达搜索
function earliestArrival(db, fromStop, toStop, startMin, horizon = 3 * DAY) {
  const net = loadNetwork(db);
  if (fromStop === toStop) return { arrival_min: startMin, legs: [], transport_version: db.version('transport') };
  const dist = {}, prev = {};
  dist[fromStop] = startMin;
  const visited = new Set();
  while (true) {
    let u = null, best = Infinity;
    for (const s in dist) if (!visited.has(s) && dist[s] < best) { best = dist[s]; u = s; }
    if (u === null) break;
    if (Number(u) === toStop) break;
    visited.add(u);
    for (const cid in net.connections) {
      const c = net.connections[cid];
      let to = null;
      if (c.from_stop === Number(u)) to = c.to_stop;
      else if (c.bidirectional && c.to_stop === Number(u)) to = c.from_stop;
      if (to === null) continue;
      const dep = nextDeparture(c, best, horizon);
      if (dep === null) continue;
      const arr = dep + c.duration_min;
      if (dist[to] === undefined || arr < dist[to]) {
        dist[to] = arr;
        prev[to] = { from: Number(u), conn: c, depart: dep, arrive: arr };
      }
    }
  }
  if (dist[toStop] === undefined)
    return { reachable: false, reason: '在时间范围内无法到达（可能受关闭公告或末班时间影响）', transport_version: db.version('transport') };
  const legs = [];
  let cur = toStop;
  while (cur !== fromStop) {
    const p = prev[cur];
    legs.unshift({
      connection_id: p.conn.id, mode: p.conn.mode,
      from_stop: p.from, to_stop: cur,
      from_name: net.stops[p.from]?.name, to_name: net.stops[cur]?.name,
      depart_min: p.depart, arrive_min: p.arrive,
      depart_text: fmt(p.depart), arrive_text: fmt(p.arrive),
      wait_min: p.depart - dist[p.from],
      cross_midnight: p.arrive >= DAY && Math.floor(p.arrive / DAY) > Math.floor(p.depart / DAY)
    });
    cur = p.from;
  }
  return {
    reachable: true, arrival_min: dist[toStop], arrival_text: fmt(dist[toStop]),
    total_min: dist[toStop] - startMin, legs, transport_version: db.version('transport')
  };
}

// 解释某连接在 t 时刻为何不可走 / 下一可走时刻
function explainConnection(conn, t) {
  const ann = closedAt(conn, t);
  if (ann) return `「${ann.title}」生效中（${fmt(ann.starts_min)}–${fmt(ann.ends_min)}），该段临时关闭`;
  if (conn.mode === 'ferry') {
    const nxt = nextFerryDeparture(conn, t);
    const todays = conn.departures.filter(d => d < t % DAY || t >= DAY);
    if (nxt === null) return '班次表内没有可用班次';
    if (nxt > t) {
      const missed = conn.departures.filter(d => d + Math.floor((t - d) / DAY) * DAY < t);
      const last = missed.length ? Math.max(...missed.map(d => d + Math.floor((t - d) / DAY) * DAY)) : null;
      if (last !== null && t - last < DAY)
        return `错过 ${fmt(last)} 班次（${t - last} 分钟前已发船），下一班 ${fmt(nxt)}，需等待 ${nxt - t} 分钟`;
      return `最近一班 ${fmt(nxt)}，需等待 ${nxt - t} 分钟`;
    }
  } else {
    const nxt = nextOpenDeparture(conn, t);
    if (nxt === null) return '开放窗口内无可用时间';
    if (nxt > t) return `当前不在开放窗口，${fmt(nxt)} 起可通行`;
  }
  return null;
}

// 预制路线检查：逐步重算，给出错过换乘解释
function checkPrebuiltRoute(db, route, startMin, horizon = 3 * DAY) {
  const net = loadNetwork(db);
  const steps = typeof route.steps === 'string' ? JSON.parse(route.steps) : route.steps;
  let cursor = startMin;
  const legs = [], issues = [];
  let feasible = true;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const conn = net.connections[st.connection_id];
    if (!conn) { issues.push({ step: i, type: 'missing', message: `第 ${i + 1} 段：连接已不存在（可能因道路改线被移除）` }); feasible = false; break; }
    const desired = Math.max(cursor, st.planned_depart_min != null ? st.planned_depart_min : cursor);
    const dep = nextDeparture(conn, desired, horizon);
    if (dep === null) {
      feasible = false;
      issues.push({ step: i, type: 'unreachable', message: `第 ${i + 1} 段（${net.stops[conn.from_stop]?.name}→${net.stops[conn.to_stop]?.name}）：${explainConnection(conn, desired) || '在可用时间范围内无法通行'}` });
      break;
    }
    if (dep > desired) {
      issues.push({
        step: i, type: 'missed_transfer',
        message: `第 ${i + 1} 段：计划 ${fmt(desired)} 出发无法赶上 —— ${explainConnection(conn, desired) || `实际最早 ${fmt(dep)} 出发`}`
      });
    }
    const arr = dep + conn.duration_min;
    legs.push({
      step: i, connection_id: conn.id, mode: conn.mode,
      from_name: net.stops[conn.from_stop]?.name, to_name: net.stops[conn.to_stop]?.name,
      planned_depart_min: st.planned_depart_min != null ? Math.max(cursor, st.planned_depart_min) : null,
      depart_min: dep, arrive_min: arr,
      depart_text: fmt(dep), arrive_text: fmt(arr),
      cross_midnight: Math.floor(arr / DAY) > Math.floor(dep / DAY)
    });
    cursor = arr;
  }
  return {
    feasible, arrival_min: feasible ? cursor : null,
    arrival_text: feasible ? fmt(cursor) : null,
    legs, issues, transport_version: db.version('transport')
  };
}

module.exports = { loadNetwork, earliestArrival, checkPrebuiltRoute, nextDeparture, explainConnection, fmt, DAY };
