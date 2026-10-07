import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from './store.js';
import { checkPrebuiltRoute, compareRoutes, earliestArrival } from './transit.js';
import { makePreviewWav, regeneratePublicTrack } from './media.js';
import { buildSnapshot, diffSnapshots, exportList, exportPrintableRoute, exportTextReader, reconcileSnapshots } from './snapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');

const jsonTypes = new Set(['POST','PUT','PATCH']);

export function createServer(store = getStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, store);
      return await serveStatic(req, res, url);
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message || 'server error' });
    }
  });
}

async function readBody(req) {
  if (!jsonTypes.has(req.method) || !req.headers['content-length']) return {};
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleApi(req, res, url, store) {
  const { pathname } = url;
  const body = await readBody(req);
  const state = () => store.get();

  if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, versions: state().versions });

  if (req.method === 'GET' && pathname === '/api/map') {
    return sendJson(res, 200, presentMap(state()));
  }
  if (req.method === 'GET' && pathname === '/api/timeline') {
    const events = [...state().events].sort((a,b) => a.date.localeCompare(b.date));
    return sendJson(res, 200, { events, places: state().places, placeLocations: state().placeLocations });
  }
  if (req.method === 'GET' && pathname === '/api/places') {
    return sendJson(res, 200, { places: state().places, placeLocations: state().placeLocations, nameRecords: state().nameRecords, relations: state().relations });
  }
  const placeMatch = pathname.match(/^\/api\/places\/([^/]+)$/);
  if (req.method === 'GET' && placeMatch) {
    const id = placeMatch[1];
    const s = state();
    const place = s.places.find(p => p.id === id);
    if (!place) throw Object.assign(new Error('Place not found'), { status: 404 });
    return sendJson(res, 200, {
      place,
      locations: s.placeLocations.filter(l => l.placeId === id),
      nameRecords: s.nameRecords.filter(n => n.placeId === id),
      relations: s.relations.filter(r => r.fromPlaceId === id || r.toPlaceId === id),
      events: s.events.filter(e => e.placeId === id),
      visitorPoints: s.visitorPoints.filter(v => v.placeId === id)
    });
  }
  if (req.method === 'POST' && pathname === '/api/places/names') {
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    const p = { recordId: id, at, status: 'proposed', ...body };
    require(p, ['placeId','name']);
    const { state: next } = await store.commit('place.nameProposed', p, body.actor, body.reason);
    return sendJson(res, 201, { record: next.nameRecords.find(x => x.id === id), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/places/names/review') {
    const at = new Date().toISOString();
    require(body, ['placeId','recordId','decision','reviewer']);
    const { state: next } = await store.commit('name.reviewed', { at, ...body }, body.reviewer, body.reviewNote);
    return sendJson(res, 200, { record: next.nameRecords.find(x => x.id === body.recordId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/places/relations') {
    const relationId = crypto.randomUUID();
    const p = { relationId, status: 'proposed', ...body };
    require(p, ['fromPlaceId','relation']);
    const { state: next } = await store.commit('place.relationProposed', p, body.actor, body.reason);
    return sendJson(res, 201, { relation: next.relations.find(x => x.id === relationId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/places/relations/review') {
    const at = new Date().toISOString();
    require(body, ['relationId','decision','reviewer']);
    const { state: next } = await store.commit('relation.reviewed', { at, ...body }, body.reviewer, body.reviewNote);
    return sendJson(res, 200, { relation: next.relations.find(x => x.id === body.relationId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/places/locations') {
    const locationId = body.locationId || crypto.randomUUID();
    const at = new Date().toISOString();
    const p = { locationId, at, status: 'proposed', ...body };
    require(p, ['placeId','geometry']);
    const { state: next } = await store.commit('placeLocation.proposed', p, body.actor, body.reason);
    return sendJson(res, 201, { location: next.placeLocations.find(x => x.id === locationId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/places/locations/review') {
    const at = new Date().toISOString();
    require(body, ['locationId','decision','reviewer']);
    const { state: next } = await store.commit('placeLocation.reviewed', { at, ...body }, body.reviewer, body.reviewNote);
    return sendJson(res, 200, { location: next.placeLocations.find(x => x.id === body.locationId), versions: next.versions });
  }

  if (req.method === 'POST' && pathname === '/api/roads/reroute') {
    const roadId = body.roadId || `road-${crypto.randomUUID()}`;
    require(body, ['label','geometry']);
    const { state: next } = await store.commit('road.rerouted', { roadId, ...body }, body.actor, body.reason);
    return sendJson(res, 201, { road: next.roads.find(r => r.id === roadId), versions: next.versions });
  }
  if (req.method === 'PATCH' && pathname === '/api/visitor-points') {
    require(body, ['pointId','patch']);
    const { state: next } = await store.commit('visitorPoint.updated', body, body.actor, body.reason);
    return sendJson(res, 200, { point: next.visitorPoints.find(v => v.id === body.pointId), versions: next.versions });
  }

  if (req.method === 'GET' && pathname === '/api/routes/network') {
    return sendJson(res, 200, { nodes: state().transitNodes, edges: state().transitEdges, prebuiltRoutes: state().prebuiltRoutes, announcements: state().announcements, versions: state().versions });
  }
  if (req.method === 'POST' && pathname === '/api/routes/prebuilt/check') {
    require(body, ['routeId','at']);
    return sendJson(res, 200, checkPrebuiltRoute(state(), body.routeId, body));
  }
  if (req.method === 'POST' && pathname === '/api/routes/earliest') {
    require(body, ['from','to','at']);
    return sendJson(res, 200, await earliestArrival(state(), body));
  }
  if (req.method === 'POST' && pathname === '/api/routes/compare') {
    require(body, ['from','to','at']);
    return sendJson(res, 200, await compareRoutes(state(), body));
  }

  if (req.method === 'GET' && pathname === '/api/announcements') return sendJson(res, 200, { announcements: state().announcements, versions: state().versions });
  if (req.method === 'POST' && pathname === '/api/announcements') {
    require(body, ['id','title','effectiveFrom']);
    const announcement = {
      kind: 'closure', active: true, affectsEdges: [], affectsPoints: [], body: '', effectiveTo: null, ...body,
      publishedAt: new Date().toISOString()
    };
    const { state: next } = await store.commit('announcement.published', { announcement }, body.actor, body.reason);
    return sendJson(res, 201, { announcement: next.announcements.find(a => a.id === announcement.id), versions: next.versions });
  }

  if (req.method === 'GET' && pathname === '/api/interviews') {
    return sendJson(res, 200, { interviews: state().interviews, segments: state().mediaSegments, tracks: state().publicTracks });
  }
  const interviewMatch = pathname.match(/^\/api\/interviews\/([^/]+)$/);
  if (req.method === 'GET' && interviewMatch) {
    const id = interviewMatch[1];
    const s = state();
    const interview = s.interviews.find(i => i.id === id);
    if (!interview) throw Object.assign(new Error('Interview not found'), { status: 404 });
    return sendJson(res, 200, { interview, segments: s.mediaSegments.filter(m => m.interviewId === id), tracks: s.publicTracks.filter(t => t.interviewId === id) });
  }
  if (req.method === 'POST' && pathname === '/api/media/license') {
    require(body, ['segmentId','license','publicPermission']);
    const at = new Date().toISOString();
    const { state: next } = await store.commit('mediaSegment.licenseChanged', { at, ...body }, body.actor, body.reason);
    const seg = next.mediaSegments.find(x => x.id === body.segmentId);
    return sendJson(res, 200, { segment: seg, track: next.publicTracks.find(t => t.segmentId === body.segmentId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/media/cut') {
    require(body, ['segmentId','cutStart','cutEnd']);
    const editId = crypto.randomUUID();
    const at = new Date().toISOString();
    const { state: next } = await store.commit('mediaSegment.cut', { editId, at, ...body }, body.actor, body.reason);
    return sendJson(res, 200, { editId, segment: next.mediaSegments.find(x => x.id === body.segmentId), track: next.publicTracks.find(t => t.segmentId === body.segmentId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/media/offset') {
    require(body, ['segmentId','audioVideoOffset']);
    const editId = crypto.randomUUID();
    const at = new Date().toISOString();
    const { state: next } = await store.commit('mediaSegment.offsetChanged', { editId, at, ...body }, body.actor, body.reason);
    return sendJson(res, 200, { editId, segment: next.mediaSegments.find(x => x.id === body.segmentId), track: next.publicTracks.find(t => t.segmentId === body.segmentId), versions: next.versions });
  }
  if (req.method === 'POST' && pathname === '/api/media/tracks/regenerate') {
    require(body, ['segmentId']);
    // Track derivation itself does not need a separate audit event; the license/edit
    // events above are the authoritative changes.
    const track = regeneratePublicTrack(store.get(), body.segmentId, body.actor || 'media-bot');
    return sendJson(res, 200, { track });
  }
  const trackWavMatch = pathname.match(/^\/api\/public-tracks\/([^/]+)\.wav$/);
  if (req.method === 'GET' && trackWavMatch) {
    const track = state().publicTracks.find(t => t.id === trackWavMatch[1]);
    if (!track || track.status !== 'generated') throw Object.assign(new Error('Public WAV unavailable'), { status: 404 });
    const wav = await makePreviewWav(0.2);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' });
    return res.end(wav);
  }

  if (req.method === 'POST' && pathname === '/api/offline/snapshot') {
    const snap = buildSnapshot(state(), body);
    const { state: next } = await store.commit('snapshot.saved', { snapshot: snap }, body.actor || 'visitor', body.reason || 'offline favorite');
    return sendJson(res, 201, { snapshot: next.snapshots.find(x => x.id === snap.id) });
  }
  if (req.method === 'GET' && pathname === '/api/offline/snapshot') {
    const id = url.searchParams.get('id');
    const snap = id ? state().snapshots.find(s => s.id === id) : state().snapshots.at(-1);
    if (!snap) throw Object.assign(new Error('Snapshot not found'), { status: 404 });
    return sendJson(res, 200, snap);
  }
  if (req.method === 'POST' && pathname === '/api/offline/build') {
    return sendJson(res, 200, buildSnapshot(state(), body));
  }
  if (req.method === 'POST' && pathname === '/api/offline/reconcile') {
    require(body, ['oldSnapshot']);
    const fresh = buildSnapshot(state(), { ...body, favoritePlaceIds: body.favoritePlaceIds || body.oldSnapshot.favorites });
    return sendJson(res, 200, reconcileSnapshots(body.oldSnapshot, fresh));
  }
  if (req.method === 'POST' && pathname === '/api/offline/diff') {
    require(body, ['oldSnapshot']);
    const fresh = buildSnapshot(state(), { ...body, favoritePlaceIds: body.favoritePlaceIds || body.oldSnapshot.favorites });
    return sendJson(res, 200, diffSnapshots(body.oldSnapshot, fresh));
  }
  if (req.method === 'POST' && pathname === '/api/offline/exports/list') {
    require(body, ['snapshot']);
    return sendJson(res, 200, exportList(body.snapshot));
  }
  if (req.method === 'POST' && pathname === '/api/offline/exports/text') {
    require(body, ['snapshot']);
    const text = exportTextReader(body.snapshot);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(text);
  }
  if (req.method === 'POST' && pathname === '/api/offline/exports/print-route') {
    require(body, ['snapshot','routeId','at']);
    const text = exportPrintableRoute(body.snapshot, body.routeId, body.at);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(text);
  }

  return sendJson(res, 404, { error: 'API not found' });
}

function presentMap(s) {
  return {
    versions: s.versions,
    places: s.places,
    locations: s.placeLocations,
    events: s.events,
    roads: s.roads,
    relations: s.relations,
    visitorPoints: s.visitorPoints,
    transitNodes: s.transitNodes,
    transitEdges: s.transitEdges,
    announcements: s.announcements
  };
}

function require(obj, keys) {
  for (const key of keys) if (obj[key] === undefined || obj[key] === null) throw Object.assign(new Error(`Missing ${key}`), { status: 400 });
}

function sendJson(res, status, data) {
  const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403); return res.end('forbidden');
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': mime(filePath) });
    return res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
}

function mime(file) {
  const ext = path.extname(file);
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

export function listen(server, port = Number(process.env.PORT) || 3000) {
  return new Promise(resolve => server.listen(port, () => resolve(server.address())));
}
