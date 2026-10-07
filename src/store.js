import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInitialState } from './seed.js';
import { recalcAfterEdits, regeneratePublicTrack } from './media.js';

let activeStore = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    this.eventsPath = path.join(dataDir, 'events.jsonl');
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init({ reset = false } = {}) {
    await fs.mkdir(this.dataDir, { recursive: true });
    if (reset) {
      await fs.rm(this.statePath, { force: true });
      await fs.rm(this.eventsPath, { force: true });
    }
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      this.state = JSON.parse(raw);
      ensureCollections(this.state);
    } catch {
      this.state = createInitialState();
      for (const seg of this.state.mediaSegments) regeneratePublicTrack(this.state, seg.id, 'seeder');
      await this._persist({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        type: 'state.initialized',
        actor: 'system',
        payload: { versions: clone(this.state.versions) }
      });
    }
    return this.state;
  }

  get() {
    if (!this.state) throw new Error('Store not initialized');
    return this.state;
  }

  snapshot() {
    return clone(this.state);
  }

  async commit(type, payload, actor = 'curator', reason = '') {
    const result = this.writeQueue.then(async () => {
      const event = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        type,
        actor,
        reason,
        payload: clone(payload)
      };
      this.apply(event);
      this.state.meta = this.state.meta || {};
      this.state.meta.lastEventId = event.id;
      this.state.meta.updatedAt = event.at;
      await this._persist(event);
      return { event, state: this.snapshot() };
    });
    // Keep chain failures from permanently poisoning the queue.
    this.writeQueue = result.catch(() => {});
    return result;
  }

  apply(event) {
    const reducer = reducers[event.type];
    if (!reducer) throw new Error(`Unknown event: ${event.type}`);
    reducer(this.state, event);
    return this.state;
  }

  async _persist(event) {
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.eventsPath, line, 'utf8');
    const tmp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmp, this.statePath);
  }
}

const reducers = {
  'state.initialized': () => {},

  'snapshot.saved': (s, e) => {
    s.snapshots.push(e.payload.snapshot);
  },

  'place.nameProposed': (s, e) => {
    const place = must(s.places, e.payload.placeId);
    s.nameRecords.push({
      id: e.payload.recordId,
      name: e.payload.name,
      language: e.payload.language || 'zh',
      start: e.payload.start || null,
      end: e.payload.end || null,
      evidence: e.payload.evidence || '',
      status: e.payload.status || 'proposed',
      reviewedAt: null,
      reviewer: null,
      reviewNote: ''
    });
    if (e.payload.status === 'approved') place.name = e.payload.name;
    bumpContent(s);
  },

  'name.reviewed': (s, e) => {
    const place = must(s.places, e.payload.placeId);
    const rec = must(s.nameRecords, e.payload.recordId);
    rec.status = e.payload.decision;
    rec.reviewedAt = e.payload.at;
    rec.reviewer = e.payload.reviewer;
    rec.reviewNote = e.payload.reviewNote || '';
    if (e.payload.decision === 'approved') place.name = rec.name;
    bumpContent(s);
  },

  'place.relationProposed': (s, e) => {
    const p = e.payload;
    if (!['renamed','relocated','flooded','same-name-different-place','successor','interview'].includes(p.relation)) {
      throw new Error('Unsupported relation');
    }
    s.relations.push({
      id: p.relationId,
      fromPlaceId: p.fromPlaceId,
      toPlaceId: p.toPlaceId || null,
      relation: p.relation,
      start: p.start || null,
      end: p.end || null,
      evidence: p.evidence || '',
      status: p.status || 'proposed',
      reviewedAt: null,
      reviewer: null,
      reviewNote: '',
      sourceDescription: p.sourceDescription || ''
    });
    bumpContent(s);
  },

  'relation.reviewed': (s, e) => {
    const rel = must(s.relations, e.payload.relationId);
    rel.status = e.payload.decision;
    rel.reviewedAt = e.payload.at;
    rel.reviewer = e.payload.reviewer;
    rel.reviewNote = e.payload.reviewNote || '';
    bumpContent(s);
  },

  'place.updated': (s, e) => {
    const place = must(s.places, e.payload.placeId);
    for (const key of ['name','kind','status','description','evidence','flooded','waterDepthNote']) {
      if (Object.hasOwn(e.payload, key)) place[key] = e.payload[key];
    }
    bumpContent(s);
  },

  'placeLocation.proposed': (s, e) => {
    const p = e.payload;
    s.placeLocations.push({
      id: p.locationId,
      placeId: p.placeId,
      status: p.status || 'proposed',
      geometry: p.geometry,
      validFrom: p.validFrom || null,
      validTo: p.validTo || null,
      confidence: p.confidence || 'low',
      evidence: p.evidence || '',
      reviewedAt: null,
      reviewer: null,
      reviewNote: ''
    });
    bumpContent(s);
  },

  'placeLocation.reviewed': (s, e) => {
    const loc = must(s.placeLocations, e.payload.locationId);
    loc.status = e.payload.decision;
    loc.reviewedAt = e.payload.at;
    loc.reviewer = e.payload.reviewer;
    loc.reviewNote = e.payload.reviewNote || '';
    if (e.payload.geometry) loc.geometry = e.payload.geometry;
    bumpContent(s);
  },

  'event.created': (s, e) => {
    const p = e.payload;
    s.events.push({
      id: p.eventId,
      date: p.date,
      endDate: p.endDate || null,
      title: p.title,
      summary: p.summary,
      category: p.category,
      placeId: p.placeId,
      placeLocationId: p.placeLocationId,
      sources: p.sources || []
    });
    bumpContent(s);
  },

  'road.rerouted': (s, e) => {
    const p = e.payload;
    s.roads.push({
      id: p.roadId,
      label: p.label,
      replacedRoadId: p.replacedRoadId || null,
      geometry: p.geometry,
      openedAt: p.openedAt || null,
      status: p.status || 'current',
      note: p.note || ''
    });
    if (p.replacedRoadId) {
      const old = must(s.roads, p.replacedRoadId);
      old.status = 'historical';
      old.supersededByRoadId = p.roadId;
    }
    bumpTraffic(s);
  },

  'visitorPoint.updated': (s, e) => {
    const point = must(s.visitorPoints, e.payload.pointId);
    Object.assign(point, e.payload.patch);
    bumpTraffic(s);
  },

  'transitEdge.updated': (s, e) => {
    const edge = must(s.transitEdges, e.payload.edgeId);
    Object.assign(edge, e.payload.patch);
    bumpTraffic(s);
  },

  'route.saved': (s, e) => {
    s.prebuiltRoutes.push(e.payload.route);
    bumpTraffic(s);
  },

  'announcement.published': (s, e) => {
    const a = e.payload.announcement;
    const idx = s.announcements.findIndex(x => x.id === a.id);
    if (idx >= 0) s.announcements[idx] = a;
    else s.announcements.push(a);
    s.announcements.sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom));
    s.versions.announcements++;
    bumpTraffic(s);
  },

  'interview.updated': (s, e) => {
    const interview = must(s.interviews, e.payload.interviewId);
    Object.assign(interview, e.payload.patch);
    bumpContent(s);
  },

  'mediaSegment.licenseChanged': (s, e) => {
    const seg = must(s.mediaSegments, e.payload.segmentId);
    seg.license = e.payload.license;
    seg.publicPermission = e.payload.publicPermission;
    seg.licenseNote = e.payload.licenseNote || '';
    seg.reviewedAt = e.payload.at;
    regeneratePublicTrack(s, e.payload.segmentId, e.actor);
    bumpContent(s);
  },

  'mediaSegment.cut': (s, e) => {
    const p = e.payload;
    const seg = must(s.mediaSegments, p.segmentId);
    const edit = {
      id: p.editId,
      at: p.at,
      kind: 'cut',
      cutStart: p.cutStart,
      cutEnd: p.cutEnd,
      reason: p.reason || ''
    };
    seg.edits.push(edit);
    seg.sourceDuration = p.sourceDurationAfter ?? seg.sourceDuration;
    recalcAfterEdits(seg);
    regeneratePublicTrack(s, p.segmentId, e.actor);
    bumpContent(s);
  },

  'mediaSegment.offsetChanged': (s, e) => {
    const p = e.payload;
    const seg = must(s.mediaSegments, p.segmentId);
    seg.edits.push({ id: p.editId, at: p.at, actor: e.actor, kind: 'av-offset', audioVideoOffset: p.audioVideoOffset, reason: p.reason || '' });
    seg.audioVideoOffset = p.audioVideoOffset;
    recalcAfterEdits(seg);
    regeneratePublicTrack(s, p.segmentId, e.actor);
    bumpContent(s);
  }
};

function ensureCollections(s) {
  for (const key of ['nameRecords','relations','placeLocations','events','roads','transitNodes','transitEdges','prebuiltRoutes','visitorPoints','announcements','interviews','mediaSegments','publicTracks','snapshots']) {
    if (!Array.isArray(s[key])) s[key] = [];
  }
  if (!s.versions) s.versions = { content: 1, transport: 1, announcements: 1 };
}

function must(list, id) {

  const item = list.find(x => x.id === id);
  if (!item) throw Object.assign(new Error(`Not found: ${id}`), { status: 404 });
  return item;
}

function bumpContent(s) {
  s.versions.content++;
}
function bumpTraffic(s) {
  s.versions.content++;
  s.versions.transport++;
}


export async function configureStore(dataDir = path.resolve('data'), opts = {}) {
  activeStore = new Store(dataDir);
  await activeStore.init(opts);
  return activeStore;
}

export function getStore() {
  if (!activeStore) throw new Error('Store not configured');
  return activeStore;
}
