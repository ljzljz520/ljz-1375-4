// interviews.js — 访谈媒体：按片段许可生成公开音轨；剪辑改动后逐字稿时码重算；音画偏移校正
function effectiveRanges(db, interviewId) {
  const edit = db.get('SELECT ranges FROM edits WHERE interview_id=?', [interviewId]);
  if (edit) return JSON.parse(edit.ranges);
  return db.all('SELECT id AS segment_id, start_ms, end_ms FROM segments WHERE interview_id=? ORDER BY idx', [interviewId]);
}

// 公开音轨：仅 license='public' 的保留区间拼接；逐字稿时码按拼接后时间轴重算
function publicTrack(db, interviewId) {
  const iv = db.get('SELECT * FROM interviews WHERE id=?', [interviewId]);
  if (!iv) return null;
  const ranges = effectiveRanges(db, interviewId);
  let cursor = 0;
  const outRanges = [], outCues = [], skipped = [];
  for (const r of ranges) {
    const seg = db.get('SELECT * FROM segments WHERE id=?', [r.segment_id]);
    if (!seg) continue;
    if (seg.license !== 'public') { skipped.push({ segment_id: seg.id, license: seg.license, label: seg.label }); continue; }
    const dur = r.end_ms - r.start_ms;
    outRanges.push({ segment_id: seg.id, label: seg.label, source_start_ms: r.start_ms, source_end_ms: r.end_ms, track_start_ms: cursor });
    for (const c of db.all('SELECT * FROM cues WHERE segment_id=? ORDER BY offset_ms', [seg.id])) {
      const abs = seg.start_ms + c.offset_ms;
      if (abs >= r.start_ms && abs < r.end_ms) {
        const track_ms = cursor + (abs - r.start_ms);
        outCues.push({
          cue_id: c.id, text: c.text, track_ms,
          corrected_ms: track_ms + iv.av_offset_ms,   // 音画偏移校正
          track_time: ms2t(track_ms), corrected_time: ms2t(track_ms + iv.av_offset_ms)
        });
      }
    }
    cursor += dur;
  }
  return {
    interview_id: interviewId, title: iv.title, av_offset_ms: iv.av_offset_ms,
    duration_ms: cursor, ranges: outRanges, cues: outCues, skipped_segments: skipped
  };
}

function ms2t(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function setEdit(db, interviewId, ranges) {
  db.run(`INSERT INTO edits(interview_id,ranges,updated_at) VALUES(?,?,datetime('now'))
          ON CONFLICT(interview_id) DO UPDATE SET ranges=excluded.ranges, updated_at=datetime('now'))`,
    [interviewId, JSON.stringify(ranges)]);
  db.logChange('content', 'interview', interviewId, 'upsert', '剪辑改动，逐字稿时码已重算');
  return publicTrack(db, interviewId);
}

function setLicense(db, segmentId, license) {
  const seg = db.get('SELECT * FROM segments WHERE id=?', [segmentId]);
  if (!seg) throw new Error('segment not found');
  db.run('UPDATE segments SET license=? WHERE id=?', [license, segmentId]);
  db.logChange('content', 'interview', seg.interview_id, 'upsert',
    license === 'public' ? `片段#${segmentId} 恢复公开` : `片段#${segmentId} 撤权为 ${license}，公开音轨已重算`);
  return publicTrack(db, seg.interview_id);
}

function setAvOffset(db, interviewId, ms) {
  db.run('UPDATE interviews SET av_offset_ms=? WHERE id=?', [ms, interviewId]);
  db.logChange('content', 'interview', interviewId, 'upsert', `音画偏移校正 ${ms}ms`);
  return publicTrack(db, interviewId);
}

module.exports = { publicTrack, setEdit, setLicense, setAvOffset, effectiveRanges, ms2t };
