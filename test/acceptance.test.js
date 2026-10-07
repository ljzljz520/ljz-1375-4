import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { Store } from '../src/store.js';
import { checkPrebuiltRoute, earliestArrival, compareRoutes } from '../src/transit.js';
import { applyCut, applyOffset, regeneratePublicTrack } from '../src/media.js';
import { buildSnapshot, diffSnapshots, exportList, exportPrintableRoute, exportTextReader, reconcileSnapshots } from '../src/snapshot.js';
import { createServer } from '../src/server.js';

async function freshStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canal-'));
  const store = new Store(dir);
  await store.init({ reset: true });
  return store;
}

test('更名、迁建、淹没和同名异址保留可审阅身份关联，旧事件位置不被道路改线回写', async () => {
  const store = await freshStore();
  const before = store.get().events.find(e => e.id === 'e-1987-west');
  const beforePoint = store.get().placeLocations.find(l => l.id === before.placeLocationId);

  await store.commit('place.nameProposed', {
    placeId: 'p-east-dock', name: '城市运河客厅码头', language: 'zh', start: '2026-10-07',
    evidence: '导览牌更换申请', status: 'proposed'
  }, 'staff', '新名称需审');
  const state1 = store.get();
  const proposed = state1.nameRecords.at(-1);
  assert.equal(proposed.status, 'proposed');
  assert.notEqual(state1.places.find(p => p.id === 'p-east-dock').name, proposed.name);

  const reviewed = await store.commit('name.reviewed', {
    placeId: 'p-east-dock', recordId: proposed.id, decision: 'approved',
    reviewer: 'archivist', reviewNote: '同意作为 2026 新称，旧称和旧坐标仍保留。'
  });
  assert.equal(reviewed.state.places.find(p => p.id === 'p-east-dock').name, '城市运河客厅码头');
  const rel = reviewed.state.relations.find(r => r.id === 'rel-xinmin-relocated');
  assert.equal(rel.relation, 'relocated');
  assert.equal(rel.status, 'approved');

  await store.commit('road.rerouted', {
    roadId: 'road-2026-bypass', label: '2026 游客大道', replacedRoadId: 'road-current-riverside',
    geometry: [{x:70,y:420},{x:300,y:500},{x:650,y:350}], openedAt: '2026-01-01', note: '当代再次改线'
  });
  const after = store.get();
  const afterPoint = after.placeLocations.find(l => l.id === before.placeLocationId);
  assert.deepEqual(afterPoint.geometry, beforePoint.geometry);
  assert.equal(after.events.find(e => e.id === 'e-1987-west').placeLocationId, before.placeLocationId);
  assert.equal(after.roads.find(r => r.id === 'road-old-embankment').status, 'historical');
  assert.equal(after.relations.some(r => r.relation === 'flooded' && r.status === 'approved'), true);
  assert.equal(after.relations.some(r => r.relation === 'same-name-different-place' && r.fromPlaceId === 'p-xujia-dock'), true);
  assert.equal(after.placeLocations.some(l => l.placeId === 'p-xujia-dock' && l.status === 'proposed'), true);
});

test('预制路线检查能解释错过换乘，动态搜索选择下一条合法连接', async () => {
  const store = await freshStore();
  const at = '2026-10-08T07:44:00.000Z';
  const pre = checkPrebuiltRoute(store.get(), 'route-day-canal', { at });
  assert.equal(pre.feasible, false);
  assert.equal(pre.missedTransfer, true);
  assert.match(pre.notices[0].message, /换乘少于 120 秒|预制班次 07:45 已经开走/);

  // Walking detour arrives earlier in this seed, but a ferry-only comparison
  // proves dynamic search legally moves the missed 07:45 connection to 09:15.
  const dynamicFerry = await earliestArrival(store.get(), { from: 'A', to: 'D', at, pollMs: 0, modes: ['walk','ferry','lock'], excludedEdgeIds: ['te-walk-A-E','te-walk-E-D'] });
  assert.equal(dynamicFerry.found, true);
  assert.deepEqual(dynamicFerry.legs.map(l => l.edgeId), ['te-walk-A-B', 'te-ferry-B-C', 'te-lock-C-D']);
  assert.equal(dynamicFerry.legs[1].departureClock, '09:15:00');
  assert.equal(dynamicFerry.legs[1].waitSec, 81 * 60);
});

test('跨午夜班次保留日期边界并正确抵达', async () => {
  const store = await freshStore();
  const at = '2026-10-08T23:20:00.000Z';
  const pre = checkPrebuiltRoute(store.get(), 'route-night-cross', { at });
  assert.equal(pre.feasible, true);
  assert.equal(pre.legs[0].departureClock, '23:30:00');
  assert.equal(pre.legs[0].arrivalClock, '00:15:00');
  assert.equal(pre.legs[0].arrivesNextDay, true);
  assert.equal(pre.legs[1].departureClock, '00:15:00');
  assert.equal(pre.arrivalClock, '00:28:00');

  const dynamic = await earliestArrival(store.get(), { from: 'B', to: 'D', at, pollMs: 0, modes: ['ferry','walk','lock'] });
  assert.equal(dynamic.arrivalAt.slice(0, 10), '2026-10-09');
});

test('船闸临时关闭时预制线被阻断，动态最早到达改走东桥步行替代线', async () => {
  const store = await freshStore();
  await store.commit('announcement.published', { announcement: {
    id: 'lock-closed-seed', kind: 'closure', title: '老北闸临时关闭', body: '检修',
    affectsEdges: ['te-lock-C-D'], affectsPoints: ['vp-lock'],
    effectiveFrom: '2026-10-08T07:00:00.000Z', effectiveTo: '2026-10-08T11:00:00.000Z',
    publishedAt: '2026-10-07T20:00:00.000Z', active: true
  }}, 'operator');
  const at = '2026-10-08T07:25:00.000Z';
  const pre = checkPrebuiltRoute(store.get(), 'route-day-canal', { at });
  assert.equal(pre.feasible, false);
  assert.equal(pre.legs.at(-1).status, 'blocked');
  assert.equal(pre.legs.at(-1).announcement.id, 'lock-closed-seed');

  const compared = await compareRoutes(store.get(), { from: 'A', to: 'D', at, routeId: 'route-day-canal', pollMs: 0 });
  assert.deepEqual(compared.dynamic.legs.map(l => l.edgeId), ['te-walk-A-E', 'te-walk-E-D']);
  assert.equal(compared.dynamic.arrivalClock, '07:44:00');
});

test('局部撤权撤回公开音轨；剪辑和音画偏移后逐字稿与公开时码重算', async () => {
  const store = await freshStore();
  const revoke = await store.commit('mediaSegment.licenseChanged', {
    segmentId: 'ms-001-family', license: 'restricted-family', publicPermission: false,
    licenseNote: '家属撤回网络公开', at: '2026-10-07T09:00:00.000Z'
  }, 'curator');
  const withdrawn = revoke.state.publicTracks.find(t => t.segmentId === 'ms-001-family');
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual(withdrawn.items, []);

  const cut = await store.commit('mediaSegment.cut', {
    segmentId: 'ms-002-flood', cutStart: 12, cutEnd: 18,
    reason: '移除隐私插话', at: '2026-10-07T09:05:00.000Z'
  }, 'editor');
  const seg = cut.state.mediaSegments.find(s => s.id === 'ms-002-flood');
  assert.equal(seg.durationAfterEdits, 60);
  const cue2 = seg.cues.find(c => c.id === 'c6');
  assert.equal(cue2.editedStart, 12);
  assert.equal(cue2.publicAudioStart, 12);
  assert.equal(cue2.editedEnd, 27);
  const track = cut.state.publicTracks.find(t => t.segmentId === 'ms-002-flood');
  assert.equal(track.items.find(i => i.cueId === 'c6').startSec, 12);

  await store.commit('mediaSegment.offsetChanged', {
    segmentId: 'ms-002-flood', audioVideoOffset: 0.5,
    reason: '音画校正', at: '2026-10-07T09:10:00.000Z'
  }, 'editor');
  const s2 = store.get();
  assert.equal(s2.mediaSegments.find(s => s.id === 'ms-002-flood').cues.find(c => c.id === 'c6').videoStart, 11.5);
});

test('离线收藏内容和交通双版本可重连差异合并，列表、无图阅读与打印路线来自同一快照且不声称实时开放', async () => {
  const store = await freshStore();
  const old = buildSnapshot(store.get(), { favoritePlaceIds: ['p-old-lock','p-north-granary','p-east-dock','p-gudao-dock'] });
  assert.equal(old.transport.liveState, 'cached-unverified');
  assert.equal(old.transport.liveCheckedAt, null);

  await store.commit('announcement.published', { announcement: {
    id: 'ferry-delay', kind: 'info', title: '渡口增加风况提示', body: '不影响路径',
    affectsEdges: ['te-ferry-B-C'], affectsPoints: [], effectiveFrom: '2026-10-08T00:00:00.000Z',
    effectiveTo: '2026-10-09T00:00:00.000Z', publishedAt: '2026-10-07T12:00:00.000Z', active: true
  }}, 'operator');
  await store.commit('place.updated', { placeId: 'p-east-dock', description: '新增无障碍登船说明。' }, 'editor');
  const fresh = buildSnapshot(store.get(), { favoritePlaceIds: old.favorites });
  const merged = reconcileSnapshots(old, fresh);
  assert.equal(merged.snapshot.content.version, fresh.versions.content);
  assert.equal(merged.snapshot.transport.version, fresh.versions.transport);
  assert.equal(merged.diff.content.changed, true);
  assert.equal(merged.diff.transport.changed, true);
  assert.match(JSON.stringify(merged.diff), /只替换发生变化/);

  const list = exportList(merged.snapshot);
  const text = exportTextReader(merged.snapshot);
  const print = exportPrintableRoute(merged.snapshot, 'route-day-canal', '2026-10-08T07:25:00.000Z');
  assert.equal(list.exportedFromSnapshot, merged.snapshot.id);
  assert.equal(list.items.every(i => i.liveState === 'cached-unverified'), true);
  assert.match(text, /未在离线文本中声称实时有效/);
  assert.match(print, /不代表出发时实时开放/);
});

function listenFree(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}
async function request(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.error}`);
  return data;
}

test('路线查询进行期间公告更新，API 观察新版本并用更新后的网络返回替代路线', async () => {
  const store = await freshStore();
  const server = createServer(store);
  const port = await listenFree(server);
  try {
    const query = request(port, 'POST', '/api/routes/compare', {
      from: 'A', to: 'D', at: '2026-10-08T07:25:00.000Z', routeId: 'route-day-canal', pollMs: 30
    });
    await new Promise(r => setTimeout(r, 80));
    await request(port, 'POST', '/api/announcements', {
      id: 'lock-closed-during-query', title: '查询中老北闸关闭', kind: 'closure',
      body: '临时检修', affectsEdges: ['te-lock-C-D'], affectsPoints: ['vp-lock'],
      effectiveFrom: '2026-10-08T08:30:00.000Z', effectiveTo: '2026-10-08T11:00:00.000Z'
    });
    const result = await query;
    assert.deepEqual(result.dynamic.legs.map(l => l.edgeId), ['te-walk-A-E', 'te-walk-E-D']);
    assert.match(result.dynamic.observedVersions.signatures.join(','), /lock-closed-during-query/);
  } finally {
    server.close();
  }
});
