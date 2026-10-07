export function buildSnapshot(state, options = {}) {
  const favoritePlaceIds = new Set(options.favoritePlaceIds || defaultFavorites(state));
  const now = new Date().toISOString();
  const content = {
    version: state.versions.content,
    savedAt: now,
    staleWarning: '此快照仅证明保存时的内容；今日开放状态必须重连核实。',
    places: state.places.filter(p => favoritePlaceIds.has(p.id)),
    placeLocations: state.placeLocations.filter(l => favoritePlaceIds.has(l.placeId)),
    relations: state.relations.filter(r => favoritePlaceIds.has(r.fromPlaceId) || favoritePlaceIds.has(r.toPlaceId)),
    nameRecords: state.nameRecords.filter(r => favoritePlaceIds.has(r.placeId)),
    events: state.events.filter(e => favoritePlaceIds.has(e.placeId)),
    interviews: state.interviews.filter(i => favoritePlaceIds.has(i.placeId)),
    mediaSegments: state.mediaSegments.filter(ms => {
      const interview = state.interviews.find(i => i.id === ms.interviewId);
      return interview && favoritePlaceIds.has(interview.placeId);
    }).map(sanitizeSegment),
    publicTracks: state.publicTracks.filter(t => {
      const seg = state.mediaSegments.find(s => s.id === t.segmentId);
      const interview = seg && state.interviews.find(i => i.id === seg.interviewId);
      return interview && favoritePlaceIds.has(interview.placeId);
    }),
    roads: state.roads
  };
  const transport = {
    version: state.versions.transport,
    announcementsVersion: state.versions.announcements,
    savedAt: now,
    liveState: 'cached-unverified',
    liveCheckedAt: null,
    transitNodes: state.transitNodes,
    transitEdges: state.transitEdges,
    prebuiltRoutes: state.prebuiltRoutes,
    visitorPoints: state.visitorPoints,
    announcements: state.announcements
  };
  return {
    id: options.id || `snap-${crypto.randomUUID()}`,
    createdAt: now,
    purpose: options.purpose || 'offline-favorites',
    versions: { content: state.versions.content, transport: state.versions.transport, announcements: state.versions.announcements },
    content,
    transport,
    favorites: [...favoritePlaceIds]
  };
}

function defaultFavorites(state) {
  return [...new Set(state.places.filter(p => ['dock','lock','granary','home'].includes(p.kind)).map(p => p.id))];
}

function sanitizeSegment(seg) {
  // The offline content bundle never treats restricted source as a public
  // track. Cues are still useful for reading, but source media URL is omitted.
  return {
    ...seg,
    sourceMediaUrl: undefined,
    cues: seg.cues.map(c => ({ ...c, sourceMediaUrl: undefined }))
  };
}

export function exportList(snapshot) {
  return {
    exportedFromSnapshot: snapshot.id,
    savedAt: snapshot.createdAt,
    staleWarning: snapshot.content.staleWarning,
    items: snapshot.content.places.map(p => ({
      id: p.id, name: p.name, kind: p.kind, status: p.status,
      events: snapshot.content.events.filter(e => e.placeId === p.id).map(e => ({ date: e.date, title: e.title })),
      liveState: 'cached-unverified'
    }))
  };
}

export function exportTextReader(snapshot) {
  const lines = [];
  lines.push(`运河船工故事站 无图阅读稿`);
  lines.push(`导出自快照 ${snapshot.id}，保存时间 ${snapshot.createdAt}`);
  lines.push(snapshot.content.staleWarning);
  lines.push('');
  for (const event of [...snapshot.content.events].sort((a,b) => a.date.localeCompare(b.date))) {
    const place = snapshot.content.places.find(p => p.id === event.placeId);
    lines.push(`${event.date}｜${event.title}`);
    lines.push(`地点身份：${place?.name || event.placeId}（历史坐标 ID：${event.placeLocationId || '待补'}）`);
    lines.push(event.summary);
    lines.push(`来源：${event.sources.join('、')}`);
    lines.push('');
  }
  lines.push('今日开放状态：未在离线文本中声称实时有效，必须重新联网核实。');
  return lines.join('\n');
}

export function exportPrintableRoute(snapshot, routeId, at) {
  const route = snapshot.transport.prebuiltRoutes.find(r => r.id === routeId);
  if (!route) throw Object.assign(new Error('Route not in snapshot'), { status: 404 });
  const edges = new Map(snapshot.transport.transitEdges.map(e => [e.id, e]));
  const nodes = new Map(snapshot.transport.transitNodes.map(n => [n.id, n]));
  const lines = [];
  lines.push(`打印路线：${route.name}`);
  lines.push(`计划开始：${at}`);
  lines.push(`导出自快照 ${snapshot.id} / 内容 v${snapshot.versions.content} / 交通 v${snapshot.versions.transport}`);
  lines.push(`公告版本 v${snapshot.versions.announcements}（${snapshot.transport.savedAt} 保存；打印件不代表出发时实时开放）`);
  lines.push('');
  route.legs.forEach((leg, i) => {
    const e = edges.get(leg.edgeId);
    lines.push(`${i + 1}. ${nodes.get(e.from)?.label} → ${nodes.get(e.to)?.label} [${modeName(e.mode)}]`);
    if (e.mode === 'ferry') lines.push(`   班次：${(e.departures || []).join('、')}${leg.intendedDeparture ? `；预制 intended ${leg.intendedDeparture}` : ''}`);
    if (e.windows) lines.push(`   时间窗：${e.windows.map(w => `${w.start}-${w.end}`).join('，')}`);
    lines.push(`   预计 ${Math.round(e.durationSec / 60)} 分钟。${e.note || ''}`);
  });
  lines.push('\n出发前请重新核实船闸/渡口公告。');
  return lines.join('\n');
}

function modeName(mode) {
  return { walk: '步行', ferry: '渡口', lock: '船闸' }[mode] || mode;
}

export function reconcileSnapshots(oldSnapshot, newSnapshot) {
  const diff = diffSnapshots(oldSnapshot, newSnapshot);
  // Only affected sections are replaced. Favorites/metadata remain local.
  const merged = {
    ...oldSnapshot,
    versions: newSnapshot.versions,
    content: diff.content.changed ? newSnapshot.content : oldSnapshot.content,
    transport: diff.transport.changed ? newSnapshot.transport : oldSnapshot.transport
  };
  return { snapshot: merged, diff };
}

export function diffSnapshots(oldSnapshot, newSnapshot) {
  return {
    content: sectionDiff('content', oldSnapshot.content, newSnapshot.content),
    transport: transportDiff(oldSnapshot.transport, newSnapshot.transport),
    summary: summarize(oldSnapshot, newSnapshot)
  };
}

function sectionDiff(name, oldSection, newSection) {
  const changed = oldSection.version !== newSection.version;
  const entities = ['places','placeLocations','relations','nameRecords','events','interviews','mediaSegments','publicTracks','roads'];
  const changes = [];
  for (const key of entities) {
    const before = new Map((oldSection[key] || []).map(x => [x.id, x]));
    const after = new Map((newSection[key] || []).map(x => [x.id, x]));
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old) changes.push({ section: name, entity: key, id, kind: 'added' });
      else if (JSON.stringify(old) !== JSON.stringify(item)) changes.push({ section: name, entity: key, id, kind: 'updated' });
    }
    for (const id of before.keys()) if (!after.has(id)) changes.push({ section: name, entity: key, id, kind: 'removed' });
  }
  return { changed, oldVersion: oldSection.version, newVersion: newSection.version, changes };
}

function transportDiff(oldSection, newSection) {
  const changed = oldSection.version !== newSection.version || oldSection.announcementsVersion !== newSection.announcementsVersion;
  const changes = [];
  for (const key of ['transitEdges','prebuiltRoutes','visitorPoints','announcements']) {
    const before = new Map((oldSection[key] || []).map(x => [x.id, x]));
    const after = new Map((newSection[key] || []).map(x => [x.id, x]));
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old) changes.push({ section: 'transport', entity: key, id, kind: 'added' });
      else if (JSON.stringify(old) !== JSON.stringify(item)) changes.push({ section: 'transport', entity: key, id, kind: 'updated' });
    }
    for (const id of before.keys()) if (!after.has(id)) changes.push({ section: 'transport', entity: key, id, kind: 'removed' });
  }
  return { changed, oldVersion: oldSection.version, newVersion: newSection.version, oldAnnouncementsVersion: oldSection.announcementsVersion, newAnnouncementsVersion: newSection.announcementsVersion, changes };
}

function summarize(oldSnap, newSnap) {
  return {
    contentVersion: `${oldSnap.versions.content} -> ${newSnap.versions.content}`,
    transportVersion: `${oldSnap.versions.transport} -> ${newSnap.versions.transport}`,
    announcementVersion: `${oldSnap.versions.announcements} -> ${newSnap.versions.announcements}`,
    rule: '只替换发生变化的内容或交通分区；旧开放状态在重连核实前继续标记为 cached-unverified。'
  };
}
