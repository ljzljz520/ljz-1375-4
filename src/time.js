export const DAY = 86400000;

export function ymd(dateLike) {
  if (typeof dateLike === 'number') return new Date(dateLike).toISOString().slice(0, 10);
  if (dateLike instanceof Date) return dateLike.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  return new Date(dateLike).toISOString().slice(0, 10);
}

export function serviceDate(dateLike) {
  return ymd(dateLike);
}

export function toSeconds(hhmmss) {
  const [h, m, sec = 0] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + sec;
}

export function fromSeconds(sec) {
  sec = Math.round(sec);
  const sign = sec < 0 ? '-' : '';
  sec = Math.abs(sec) % DAY;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function combineServiceTime(date, hhmmss, dayOffset = 0) {
  return Date.parse(`${date}T00:00:00.000Z`) + toSeconds(hhmmss) * 1000 + dayOffset * DAY;
}

export function isoTime(ms) {
  return new Date(ms).toISOString();
}

export function clockTime(ms) {
  return new Date(ms).toISOString().slice(11, 19);
}

// A window can cross midnight. The *opening* is on the service date; the
// closing may be on the next calendar day.
export function windowRange(windowSpec, date) {
  const start = combineServiceTime(date, windowSpec.start, 0);
  let end = combineServiceTime(date, windowSpec.end, 0);
  if (end <= start) end += DAY;
  return { start, end };
}

export function nextWindowOpen(windows, atMs) {
  const candidates = [];
  for (const w of windows || []) {
    for (let offset = -1; offset <= 2; offset++) {
      const date = new Date(Math.floor(atMs / DAY) * DAY + offset * DAY).toISOString().slice(0, 10);
      const range = windowRange(w, date);
      candidates.push(range.start);
    }
  }
  return candidates.filter(t => t >= atMs).sort((a, b) => a - b)[0] ?? null;
}

export function openWindowContaining(windows, atMs) {
  const dayStart = Math.floor(atMs / DAY) * DAY;
  for (let offset = -1; offset <= 0; offset++) {
    const date = new Date(dayStart + offset * DAY).toISOString().slice(0, 10);
    for (const w of windows || []) {
      const range = windowRange(w, date);
      if (atMs >= range.start && atMs < range.end) return range;
    }
  }
  return null;
}

export function withinAnyWindow(windows, atMs) {
  const dayStart = Math.floor(atMs / DAY) * DAY;
  for (let offset = -1; offset <= 0; offset++) {
    const date = new Date(dayStart + offset * DAY).toISOString().slice(0, 10);
    for (const w of windows || []) {
      const { start, end } = windowRange(w, date);
      if (atMs >= start && atMs < end) return true;
    }
  }
  return false;
}
