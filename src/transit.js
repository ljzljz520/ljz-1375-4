import { DAY, clockTime, combineServiceTime, fromSeconds, isoTime, nextWindowOpen, openWindowContaining, toSeconds, withinAnyWindow, ymd } from './time.js';

export function activeAnnouncements(state, atMs = Date.now()) {
  return state.announcements.filter(a => a.active && (!a.effectiveFrom || atMs >= Date.parse(a.effectiveFrom)) && (!a.effectiveTo || atMs <= Date.parse(a.effectiveTo)));
}

export function edgeClosureMap(state, atMs) {
  const map = new Map();
  for (const a of activeAnnouncements(state, atMs)) {
    for (const edgeId of a.affectsEdges || []) {
      if (!map.has(edgeId)) map.set(edgeId, a);
    }
  }
  return map;
}

function nodeMap(state) {
  return new Map(state.transitNodes.map(n => [n.id, n]));
}
function edgeMap(state) {
  return new Map(state.transitEdges.map(e => [e.id, e]));
}

function closureForEdge(state, edgeId, startMs, endMs = startMs) {
  return activeAnnouncements(state, startMs).find(a => {
    if (!(a.affectsEdges || []).includes(edgeId)) return false;
    const from = a.effectiveFrom ? Date.parse(a.effectiveFrom) : -Infinity;
    const to = a.effectiveTo ? Date.parse(a.effectiveTo) : Infinity;
    return startMs < to && endMs >= from;
  }) || null;
}

export function isEdgeUsableAt(state, edge, atMs) {
  const closure = closureForEdge(state, edge.id, atMs, atMs + (edge.durationSec || 0) * 1000);
  if (closure) return { ok: false, reason: 'closed', announcement: closure };
  if (edge.mode === 'ferry') return { ok: true };
  const ok = withinAnyWindow(edge.windows, atMs);
  return ok ? { ok: true } : { ok: false, reason: 'window-closed' };
}

// Find earliest departure/traversal time no earlier than atMs.
// Walk/lock windows are continuous holding intervals; a lock also has service
// duration after entering. Ferries use explicit timetable departures.
export function nextEdgeTraversal(state, edge, atMs, { arriveByEdge = false } = {}) {
  const immediateEnd = atMs + (edge.durationSec || 0) * 1000;
  const closureNow = closureForEdge(state, edge.id, atMs, immediateEnd);
  if (closureNow) return { available: false, reason: 'closed', announcement: closureNow };

  if (edge.mode === 'ferry') {
    const date = ymd(atMs);
    const candidates = [];
    for (let offset = -1; offset <= 3; offset++) {
      for (const dep of edge.departures || []) {
        const t = combineServiceTime(date, dep, offset);
        if (t >= atMs) candidates.push(t);
      }
    }
    candidates.sort((a, b) => a - b);
    for (const departure of candidates) {
      const arrival = departure + edge.durationSec * 1000;
      const closureAtDeparture = closureForEdge(state, edge.id, departure, arrival);
      if (closureAtDeparture) return { available: false, reason: 'closed', at: departure, arrival, announcement: closureAtDeparture };
      candidates[0] = departure;
      return { available: true, departure, arrival, timetable: clockTime(departure), arrivesNextDay: ymd(arrival) !== ymd(departure) };
    }
    return { available: false, reason: 'no-departure' };
  }

  // A pedestrian may enter immediately inside a time window; if the entire
  // traversal should finish before close, use conservative walk scheduling.
  const immediateArrival = atMs + edge.durationSec * 1000;
  if (withinAnyWindow(edge.windows, atMs)) {
    const closureDuringTraversal = closureForEdge(state, edge.id, atMs, immediateArrival);
    if (closureDuringTraversal) return { available: false, reason: 'closed', at: atMs, arrival: immediateArrival, announcement: closureDuringTraversal };
    // Entries that would finish after the closing instant must wait for the
    // next window instead of returning an impossible half-completed leg.
    const openWindow = openWindowContaining(edge.windows, atMs);
    if (openWindow && immediateArrival > openWindow.end) {
      const open = nextWindowOpen(edge.windows, atMs);
      const arrival = open + edge.durationSec * 1000;
      return { available: true, departure: open, arrival, timetable: clockTime(open), waitReason: 'would-finish-after-close', arrivesNextDay: ymd(arrival) !== ymd(open) };
    }
    return { available: true, departure: atMs, arrival: immediateArrival, timetable: clockTime(atMs), arrivesNextDay: ymd(immediateArrival) !== ymd(atMs) };
  }
  const open = nextWindowOpen(edge.windows, atMs);
  if (!open) return { available: false, reason: 'window-closed' };
  const closureAtOpen = closureForEdge(state, edge.id, open, open + edge.durationSec * 1000);
  if (closureAtOpen) return { available: false, reason: 'closed', at: open, announcement: closureAtOpen };
  const arrival = open + edge.durationSec * 1000;
  return { available: true, departure: open, arrival, timetable: clockTime(open), waitReason: 'window-closed', arrivesNextDay: ymd(arrival) !== ymd(open) };
}

function outgoing(state, nodeId) {
  return state.transitEdges.filter(e => e.from === nodeId);
}

function reconstruct(state, prev, endId, algorithm, observedVersions) {
  const legs = [];
  let cur = endId;
  while (prev.get(cur)) {
    const item = prev.get(cur);
    legs.unshift(item.leg);
    cur = item.from;
  }
  const arrivalAtEnd = legs.length ? legs[legs.length - 1].arrivalAtMs : null;
  return {
    found: legs.length > 0,
    algorithm,
    from: legs.length ? legs[0].from : endId,
    to: endId,
    legs,
    arrivalAtMs: arrivalAtEnd,
    arrivalAt: arrivalAtEnd ? isoTime(arrivalAtEnd) : null,
    arrivalClock: arrivalAtEnd ? clockTime(arrivalAtEnd) : null,
    durationMin: legs.length ? Math.round((arrivalAtEnd - legs[0].departureAtMs) / 60000) : null,
    observedVersions
  };
}

export async function earliestArrival(state, input) {
  const startMs = Date.parse(input.at);
  if (Number.isNaN(startMs)) throw Object.assign(new Error('Invalid at'), { status: 400 });
  const from = input.from, to = input.to;
  const nodes = nodeMap(state);
  if (!nodes.has(from) || !nodes.has(to)) throw Object.assign(new Error('Unknown transit node'), { status: 400 });
  const startObservation = announcementObservation(state, startMs);
  if (from === to) return { found: true, algorithm: 'earliest-arrival', from, to, legs: [], arrivalAtMs: startMs, arrivalAt: isoTime(startMs), arrivalClock: clockTime(startMs), durationMin: 0, observedVersions: startObservation };

  const maxRestarts = input.maxRestarts ?? 6;
  const pollMs = input.pollMs ?? 25;
  let restartCount = 0;
  const observedSignatures = [startObservation.signature];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function runSearch(versionAtStart) {
    const labels = new Map();
    const prev = new Map();
    const settled = new Set();
    labels.set(from, startMs);

    while (true) {
      // Simulate a long-running server-side search and observe fresh
      // operational announcements. HTTP tests publish to the same persisted
      // state while this coroutine is waiting.
      await sleep(pollMs);
      const fresh = announcementObservation(state, startMs);
      if (fresh.signature !== versionAtStart.signature) {
        return { restart: true, version: fresh };
      }

      let nodeId = null;
      let best = Infinity;
      for (const [id, t] of labels) {
        if (!settled.has(id) && t < best) {
          best = t; nodeId = id;
        }
      }
      if (!nodeId) break;
      if (nodeId === to) break;
      const at = labels.get(nodeId);
      settled.add(nodeId);

      for (const edge of outgoing(state, nodeId)) {
        if (input.modes && !input.modes.includes(edge.mode)) continue;
        if (input.excludedEdgeIds?.includes(edge.id)) continue;
        const step = nextEdgeTraversal(state, edge, at);
        if (!step.available) continue;

        // A timetable edge reached with less than minTransferSec slack is a
        // missed transfer. The search must find a later legal connection.
        const previous = prev.get(nodeId);
        // minTransferSec is timetable-specific slack (mainly ferries); a lock
        // or walk can be entered as soon as the previous ride arrives.
        if (edge.mode === 'ferry' && edge.minTransferSec && previous && (step.departure - at) / 1000 < edge.minTransferSec) continue;

        const target = edge.to;
        if (!labels.has(target) || step.arrival < labels.get(target)) {
          labels.set(target, step.arrival);
          prev.set(target, {
            from: nodeId,
            leg: {
              edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to,
              label: nodes.get(edge.from)?.label, targetLabel: nodes.get(edge.to)?.label,
              departureAtMs: step.departure, departureAt: isoTime(step.departure), departureClock: clockTime(step.departure),
              arrivalAtMs: step.arrival, arrivalAt: isoTime(step.arrival), arrivalClock: clockTime(step.arrival),
              waitSec: Math.max(0, Math.round((step.departure - at) / 1000)),
              durationSec: edge.durationSec, distanceM: edge.distanceM, note: edge.note,
              timetable: step.timetable, arrivesNextDay: step.arrivesNextDay
            }
          });
        }
      }
    }

    const endObservation = announcementObservation(state, startMs);
    return reconstruct(state, prev, to, 'earliest-arrival', {
      announcementsAtStart: startObservation,
      announcementsAtEnd: endObservation,
      restartCount,
      signatures: [...new Set(observedSignatures)]
    });
  }

  let version = startObservation;
  while (restartCount <= maxRestarts) {
    const attempt = await runSearch(version);
    if (!attempt.restart) return attempt;
    restartCount++;
    observedSignatures.push(attempt.version.signature);
    version = attempt.version;
    if (input.onAnnouncementChange) await input.onAnnouncementChange({ restartCount, version });
  }
  throw Object.assign(new Error('Too many announcement updates during route search'), { status: 409 });
}

export function announcementObservation(state, atMs = Date.now()) {
  const active = activeAnnouncements(state, atMs);
  // Include every operational announcement id in the observed signature, even
  // one scheduled for later in the journey. Traversal helpers independently
  // decide whether its interval affects a particular edge at a time.
  return {
    contentVersion: state.versions.content,
    transportVersion: state.versions.transport,
    announcementsVersion: state.versions.announcements,
    at: isoTime(atMs),
    activeIds: active.map(a => a.id).sort(),
    allAnnouncementIds: state.announcements.map(a => a.id).sort(),
    signature: `${state.versions.content}:${state.versions.announcements}:${state.announcements.map(a => a.id).sort().join('|')}`
  };
}

export function checkPrebuiltRoute(state, routeId, atInput) {
  const route = state.prebuiltRoutes.find(r => r.id === routeId);
  if (!route) throw Object.assign(new Error('Unknown prebuilt route'), { status: 404 });
  const at = typeof atInput === 'string' ? atInput : atInput.at;
  const startMs = Date.parse(at);
  if (Number.isNaN(startMs)) throw Object.assign(new Error('Invalid at'), { status: 400 });
  const edges = edgeMap(state);
  const nodes = nodeMap(state);
  let cursor = startMs;
  let previousLeg = null;
  const legs = [];
  const notices = [];
  let feasible = true;
  let missedTransfer = false;

  for (let i = 0; i < route.legs.length; i++) {
    const spec = route.legs[i];
    const edge = edges.get(spec.edgeId);
    if (!edge) throw Object.assign(new Error(`Route has missing edge ${spec.edgeId}`), { status: 500 });
    const usable = isEdgeUsableAt(state, edge, cursor);
    if (!usable.ok && usable.reason === 'closed') {
      feasible = false;
      legs.push({ edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to, status: 'blocked', blockedAt: isoTime(cursor), announcement: usable.announcement });
      notices.push({ kind: 'closed', edgeId: edge.id, message: `${edge.id} 因公告「${usable.announcement.title}」临时关闭` });
      break;
    }

    if (edge.mode === 'ferry') {
      const intended = spec.intendedDeparture ? combineServiceTime(ymd(cursor), spec.intendedDeparture, 0) : null;
      const date = ymd(cursor);
      const departures = (edge.departures || []).flatMap(dep => [-1, 0, 1].map(offset => combineServiceTime(date, dep, offset))).sort((a,b)=>a-b);
      let departure = departures.find(t => t >= cursor);
      let status = 'ok';
      let missedIntended = false;
      if (intended && intended < cursor) {
        missedIntended = true;
        feasible = false;
        missedTransfer = true;
        status = 'missed-intended';
        notices.push({ kind: 'missed-intended', edgeId: edge.id, message: `${clockTime(cursor)} 才到达 ${nodes.get(edge.from)?.label}，预制班次 ${spec.intendedDeparture} 已经开走；预制路线按原计划不可执行，动态搜索会改查后续连接。` });
        legs.push({ edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to, status: 'missed-intended', intendedDeparture: spec.intendedDeparture, at: isoTime(cursor) });
        break;
      }
      if (intended && intended >= cursor) departure = intended;
      if (!departure) {
        feasible = false;
        legs.push({ edgeId: edge.id, status: 'no-service', at: isoTime(cursor) });
        notices.push({ kind: 'no-service', edgeId: edge.id, message: `${edge.id} 没有可搭乘班次` });
        break;
      }
      if (previousLeg && edge.minTransferSec && (departure - cursor) / 1000 < edge.minTransferSec) {
        feasible = false;
        missedTransfer = true; status = 'missed-transfer';
        notices.push({
          kind: 'missed-transfer', edgeId: edge.id,
          message: `${clockTime(cursor)} 到达 ${nodes.get(edge.from)?.label}，${clockTime(departure)} 开船；换乘少于 ${edge.minTransferSec} 秒，不能上船。下一班需重新查询。`
        });
      }
      const arrival = departure + edge.durationSec * 1000;
      legs.push({
        edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to,
        status: feasible ? status : 'blocked-transfer',
        intendedDeparture: spec.intendedDeparture || null,
        missedIntended,
        departureAtMs: departure, departureAt: isoTime(departure), departureClock: clockTime(departure),
        arrivalAtMs: feasible ? arrival : null, arrivalAt: feasible ? isoTime(arrival) : null, arrivalClock: feasible ? clockTime(arrival) : null,
        waitSec: Math.round((departure - cursor) / 1000),
        durationSec: edge.durationSec, arrivesNextDay: feasible && ymd(arrival) !== ymd(departure),
        note: edge.note
      });
      if (!feasible) break;
      cursor = arrival;
      previousLeg = legs[legs.length - 1];
    } else {
      const next = nextEdgeTraversal(state, edge, cursor);
      if (!next.available) {
        feasible = false;
        legs.push({ edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to, status: next.reason, at: isoTime(cursor) });
        notices.push({ kind: next.reason, edgeId: edge.id, message: `${edge.id} 当前不可进入` });
        break;
      }
      legs.push({
        edgeId: edge.id, mode: edge.mode, from: edge.from, to: edge.to, status: 'ok',
        departureAtMs: next.departure, departureAt: isoTime(next.departure), departureClock: clockTime(next.departure),
        arrivalAtMs: next.arrival, arrivalAt: isoTime(next.arrival), arrivalClock: clockTime(next.arrival),
        waitSec: Math.round((next.departure - cursor) / 1000),
        durationSec: edge.durationSec, arrivesNextDay: next.arrivesNextDay, note: edge.note
      });
      cursor = next.arrival;
      previousLeg = legs[legs.length - 1];
    }
  }

  return {
    routeId, name: route.name, from: route.from, to: route.to, feasible, missedTransfer,
    legs, notices,
    arrivalAtMs: feasible && legs.length ? legs[legs.length - 1].arrivalAtMs : null,
    arrivalAt: feasible && legs.length ? legs[legs.length - 1].arrivalAt : null,
    arrivalClock: feasible && legs.length ? legs[legs.length - 1].arrivalClock : null,
    observed: announcementObservation(state, startMs)
  };
}

export async function compareRoutes(state, input) {
  const prebuilt = input.routeId ? checkPrebuiltRoute(state, input.routeId, { at: input.at }) : null;
  const dynamic = await earliestArrival(state, input);
  let comparison = null;
  if (prebuilt?.feasible && dynamic.found) {
    const diffMin = Math.round((prebuilt.arrivalAtMs - dynamic.arrivalAtMs) / 60000);
    comparison = {
      earlierAlgorithm: diffMin === 0 ? 'tie' : diffMin > 0 ? 'earliest-arrival' : 'prebuilt',
      prebuiltArrivesMinusDynamicMin: diffMin,
      explanation: diffMin === 0 ? '预制路线检查与动态搜索同时到达。' :
        diffMin > 0 ? `动态最早到达早 ${diffMin} 分钟：它会在时间窗和班表间重新选择连接。` :
          `预制路线早 ${-diffMin} 分钟；动态搜索仍保留为关闭/改线时的替代方案。`
    };
  }
  return { prebuilt, dynamic, comparison };
}
