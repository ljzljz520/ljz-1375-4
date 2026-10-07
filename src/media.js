
export function regeneratePublicTrack(state, segmentId, actor = 'media-bot') {
  const segment = state.mediaSegments.find(s => s.id === segmentId);
  if (!segment) throw Object.assign(new Error('Unknown media segment'), { status: 404 });
  const interview = state.interviews.find(i => i.id === segment.interviewId);
  const existing = state.publicTracks.find(t => t.segmentId === segmentId);
  const now = new Date().toISOString();
  if (!segment.publicPermission || !isPublicLicense(segment.license)) {
    const revoked = {
      id: existing?.id || `track-${segmentId}`,
      segmentId,
      status: 'withdrawn',
      generatedAt: existing?.generatedAt || now,
      withdrawnAt: now,
      withdrawnBy: actor,
      license: segment.license,
      reason: segment.licenseNote || '片段许可不包含公开发布',
      items: []
    };
    if (existing) Object.assign(existing, revoked);
    else state.publicTracks.push(revoked);
    return revoked;
  }

  const items = segment.cues.map((cue, index) => ({
    order: index,
    cueId: cue.id,
    startSec: Number(cue.publicAudioStart ?? cue.editedStart ?? cue.sourceStart),
    endSec: Number(cue.editedEnd ?? cue.sourceEnd),
    text: cue.text,
    speaker: cue.speaker,
    videoStartSec: cue.videoStart ?? null,
    audioVideoOffset: segment.audioVideoOffset || 0
  }));
  const track = {
    id: existing?.id || `track-${segmentId}`,
    segmentId,
    interviewId: segment.interviewId,
    interviewTitle: interview?.title || '',
    title: segment.title,
    speaker: interview?.speaker || '',
    status: 'generated',
    generatedAt: now,
    license: segment.license,
    licenseNote: segment.licenseNote,
    durationSec: segment.durationAfterEdits,
    items,
    manifestVersion: (existing?.manifestVersion || 0) + 1,
    sourceHash: sourceFingerprint(segment)
  };
  if (existing) Object.assign(existing, track);
  else state.publicTracks.push(track);
  return existing || state.publicTracks.find(t => t.segmentId === segmentId);
}

export function isPublicLicense(license) {
  return /^CC\s+/i.test(license);
}

export function sourceFingerprint(segment) {
  const body = JSON.stringify({
    duration: segment.durationAfterEdits,
    license: segment.license,
    publicPermission: segment.publicPermission,
    edits: segment.edits,
    cues: segment.cues.map(c => [c.id, c.editedStart, c.editedEnd, c.publicAudioStart, c.videoStart, c.text])
  });
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `f1-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function applyCut(state, segmentId, cutStart, cutEnd, reason, actor) {
  if (!(cutEnd > cutStart) || cutStart < 0) throw Object.assign(new Error('Invalid cut range'), { status: 400 });
  const seg = state.mediaSegments.find(s => s.id === segmentId);
  if (!seg) throw Object.assign(new Error('Unknown media segment'), { status: 404 });
  if (cutEnd > seg.sourceDuration) throw Object.assign(new Error('Cut exceeds source duration'), { status: 400 });
  const editId = crypto.randomUUID();
  const at = new Date().toISOString();
  seg.edits.push({ id: editId, at, actor, kind: 'cut', cutStart, cutEnd, reason: reason || '' });
  recalcAfterEdits(seg);
  regeneratePublicTrack(state, segmentId, actor);
  return { editId, segment: seg };
}

export function applyOffset(state, segmentId, offset, reason, actor) {
  const seg = state.mediaSegments.find(s => s.id === segmentId);
  if (!seg) throw Object.assign(new Error('Unknown media segment'), { status: 404 });
  const editId = crypto.randomUUID();
  const at = new Date().toISOString();
  seg.audioVideoOffset = offset;
  seg.edits.push({ id: editId, at, actor, kind: 'av-offset', audioVideoOffset: offset, reason: reason || '' });
  recalcAfterEdits(seg);
  regeneratePublicTrack(state, segmentId, actor);
  return { editId, segment: seg };
}

export function recalcAfterEdits(segment) {
  // sourceStart/sourceEnd are immutable source timecodes. Edited timelines are
  // derived from the ordered cut list, so repeated edits always recompute all
  // cues instead of shifting already shifted values.
  if (!segment.originalCues) segment.originalCues = JSON.parse(JSON.stringify(segment.cues));
  const sourceCues = segment.originalCues;
  const cuts = segment.edits.filter(e => e.kind === 'cut').sort((a,b) => a.cutStart - b.cutStart);
  const removedTotal = cuts.reduce((sum, c) => sum + (c.cutEnd - c.cutStart), 0);
  const result = [];
  for (const cue of sourceCues) {
    const overlaps = cuts.some(c => c.cutStart < cue.sourceEnd && c.cutEnd > cue.sourceStart);
    if (overlaps) continue;
    const before = cuts.filter(c => c.cutEnd <= cue.sourceStart).reduce((sum, c) => sum + (c.cutEnd - c.cutStart), 0);
    result.push({
      ...cue,
      editedStart: cue.sourceStart - before,
      editedEnd: cue.sourceEnd - before,
      publicAudioStart: cue.sourceStart - before,
      videoStart: Number((cue.sourceStart - before - (segment.audioVideoOffset || 0)).toFixed(3))
    });
  }
  segment.cues = result;
  segment.durationAfterEdits = Math.max(0, segment.sourceDuration - removedTotal);
}

export async function makePreviewWav(seconds = 0.2, sampleRate = 8000) {
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.12 * 32767;
    buffer.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return buffer;
}
