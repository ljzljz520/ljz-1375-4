const $ = s => document.querySelector(s);
const api = async (url, opts={}) => {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let mapData, routeNetwork, selectedEvent;

document.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  $(`#tab-${btn.dataset.tab}`).classList.add('active');
}));

async function init() {
  mapData = await api('/api/map');
  $('#versionBadge').textContent = `内容 v${mapData.versions.content} · 交通 v${mapData.versions.transport} · 公告 v${mapData.versions.announcements}`;
  renderTimeline(); renderMap(); renderPlace(null);
  routeNetwork = await api('/api/routes/network');
  fillNodeSelects();
  await renderInterviews();
}

function kindName(k){return {dock:'码头',lock:'船闸',granary:'粮仓',home:'家庭访谈',bridge:'桥梁'}[k]||k}
function statusName(s){return {active:'使用中',relocated:'已迁建',flooded:'已淹没',unlocated:'待定位',historical:'历史点'}[s]||s}
function modeName(m){return {walk:'步行',ferry:'渡口',lock:'船闸'}[m]||m}

function renderTimeline() {
  const events = [...mapData.events].sort((a,b)=>a.date.localeCompare(b.date));
  $('#timeline').innerHTML = events.map(e => {
    const p = mapData.places.find(x => x.id === e.placeId);
    return `<article class="timeline-item" data-id="${e.id}"><time>${e.date}</time><h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p><span class="pill">${esc(kindName(p?.kind))} · ${esc(p?.name)}</span></article>`;
  }).join('');
  document.querySelectorAll('.timeline-item').forEach(el => el.onclick = () => selectEvent(el.dataset.id));
}

function selectEvent(eventId) {
  selectedEvent = eventId;
  document.querySelectorAll('.timeline-item').forEach(el => el.classList.toggle('selected', el.dataset.id === eventId));
  const e = mapData.events.find(x => x.id === eventId);
  renderMap(); renderPlace(e.placeId, e);
}

function pointFor(placeId, locationId) {
  const locs = mapData.locations.filter(l => l.placeId === placeId);
  return mapData.locations.find(l => l.id === locationId) || locs.find(l=>l.status==='confirmed') || locs[0];
}
function nodeCoord(nodeId) {
  const node = mapData.transitNodes.find(n => n.id === nodeId);
  const vp = mapData.visitorPoints.find(v => v.id === node?.pointId);
  return pointFor(vp?.placeId)?.geometry;
}
function path(points) { return points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '); }
function renderMap() {
  const svg = $('#map');
  const nodes = new Map(mapData.transitNodes.map(n => [n.id, n]));
  let roads = `<path class="waterline" d="M120 150 C260 120 360 240 500 210 S700 310 790 270" />`;
  roads += mapData.roads.map(r => `<path class="road-${r.status}" d="${path(r.geometry)}"><title>${esc(r.label)}：${esc(r.note)}</title></path>`).join('');
  for (const e of mapData.transitEdges) {
    const a = nodeCoord(e.from), b = nodeCoord(e.to);
    if (!a || !b) continue;
    roads += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${e.mode==='ferry'?'#0d6c8c':'#778a8d'}" stroke-width="2" stroke-dasharray="${e.mode==='walk'?'1 0':'6 5'}"><title>${esc(e.id)} ${esc(e.note||'')}</title></line>`;
  }
  const selectedLocation = selectedEvent ? mapData.events.find(e=>e.id===selectedEvent)?.placeLocationId : null;
  const markers = mapData.places.map(p => {
    const locs = mapData.locations.filter(l => l.placeId === p.id);
    return locs.map(l => {
      const active = selectedLocation === l.id;
      return `<g class="marker ${l.status==='proposed'?'proposed':''} ${p.status==='unlocated'?'unlocated':''}" data-place="${p.id}" transform="translate(${l.geometry.x},${l.geometry.y})">
      <circle r="${active?11:8}" fill="${colorFor(p.kind,l.status)}" stroke-width="${active?4:2}"/>
      <text x="12" y="4">${esc(p.name)}${l.status==='proposed'?'（待定位）':''}</text><title>${esc(p.name)} / ${l.status} / ${l.validFrom||''}${l.validTo?'-'+l.validTo:''}</title></g>`;
    }).join('');
  }).join('');
  const relationLines = mapData.relations.filter(r=>r.status==='approved' && r.toPlaceId).map(r => {
    const a = mapData.locations.find(l=>l.placeId===r.fromPlaceId);
    const b = mapData.locations.find(l=>l.placeId===r.toPlaceId);
    return a&&b?`<line class="relation" x1="${a.geometry.x}" y1="${a.geometry.y}" x2="${b.geometry.x}" y2="${b.geometry.y}"><title>${r.relation}: ${r.reviewNote}</title></line>`:'';
  }).join('');
  svg.innerHTML = roads + relationLines + markers;
  svg.querySelectorAll('.marker').forEach(m => m.onclick = () => renderPlace(m.dataset.place));
}
function colorFor(kind, status) {
  if (status === 'historical') return '#8d7b70';
  return {dock:'#7c5aa8',lock:'#2763a3',granary:'#c49423',home:'#47844d',bridge:'#6a7880'}[kind] || '#777';
}

function renderPlace(placeId, focusEvent) {
  if (!placeId) {
    $('#placeDetail').innerHTML = '<h3>选择时间轴或地图点</h3><p>旧事件固定在发生时的历史坐标；道路今日改线不会回写这些位置。</p>';
    return;
  }
  const p = mapData.places.find(x => x.id === placeId);
  const locs = mapData.locations.filter(l => l.placeId === placeId);
  const rels = mapData.relations.filter(r => r.fromPlaceId === placeId || r.toPlaceId === placeId);
  const events = mapData.events.filter(e => e.placeId === placeId);
  $('#placeDetail').innerHTML = `<h3>${esc(p.name)} <span class="pill">${kindName(p.kind)}</span><span class="pill ${p.status==='unlocated'?'warn':''}">${statusName(p.status)}</span></h3>
  <p>${esc(p.description)}</p><p><b>证据：</b>${esc(p.evidence)}</p>
  ${p.flooded?`<p class="warning">${esc(p.waterDepthNote)} 今日 visitor point 是安全观景台而非遗址。</p>`:''}
  <div>${locs.map(l=>`<span class="pill ${l.status==='proposed'?'warn':''}">${l.status} ${l.validFrom||'?'}${l.validTo?'-'+l.validTo:''} · ${l.confidence}</span>`).join('')}</div>
  <p><b>关联审阅：</b></p>${rels.map(r=>`<div class="notice">${r.relation}：${esc(r.reviewNote||r.evidence)} <b>[${r.status}]</b></div>`).join('') || '<p>无</p>'}
  ${focusEvent?`<p><b>当前时间轴事件坐标：</b>${focusEvent.placeLocationId}，不会因道路改线移动。</p>`:''}`;
}

function fillNodeSelects() {
  const opts = routeNetwork.nodes.map(n=>`<option value="${n.id}">${n.id} ${esc(n.label)}</option>`).join('');
  $('#fromNode').innerHTML = opts; $('#toNode').innerHTML = opts;
  $('#fromNode').value='A'; $('#toNode').value='D';
  $('#prebuiltRoute').innerHTML = routeNetwork.prebuiltRoutes.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');
  $('#prebuiltRoute').value='route-day-canal';
}
$('#routeForm').onsubmit = async e => { e.preventDefault(); await runCompare(false); };
$('#publishClosure').onclick = async () => {
  const id = `lock-closure-${Date.now()}`;
  await api('/api/announcements', { method:'POST', body: { id, title:'老北闸临时关闭检修', kind:'closure', body:'10:00-11:00 船闸连接线临时关闭。', affectsEdges:['te-lock-C-D'], affectsPoints:['vp-lock'], effectiveFrom:'2026-10-08T07:00:00.000Z', effectiveTo:'2026-10-08T11:00:00.000Z', actor:'operator' } });
  $('#routeAt').value = '2026-10-08T07:25:00.000Z';
  await runCompare(true);
};
async function runCompare(closurePublished) {
  routeNetwork = await api('/api/routes/network');
  const body = { from: $('#fromNode').value, to: $('#toNode').value, at: $('#routeAt').value, routeId: $('#prebuiltRoute').value };
  const data = await api('/api/routes/compare', { method:'POST', body });
  const renderLegs = legs => legs.map(l=>`<div class="leg"><b>${modeName(l.mode)}</b> ${l.from}→${l.to}<br>${l.departureClock||''} 开 / ${l.arrivalClock?l.arrivalClock+' 到':''} ${l.arrivesNextDay?'<span class="pill warn">跨午夜</span>':''}<br><small>${esc(l.note||'')}</small>${l.announcement?`<div class="notice bad">公告关闭：${esc(l.announcement.title)}</div>`:''}</div>`).join('');
  $('#routeResult').innerHTML = `${closurePublished?'<div class="notice bad">公告已在查询期间/重查前更新，观察版本已变化。</div>':''}
  <div class="routecard"><h3>预制路线检查</h3>${(data.prebuilt.notices||[]).map(n=>`<div class="notice ${n.kind.includes('missed')||n.kind==='closed'?'bad':''}">${esc(n.message)}</div>`).join('')}${renderLegs(data.prebuilt.legs)}<p>${data.prebuilt.feasible?`可到达：${data.prebuilt.arrivalClock}`:'预制路线按该时间不可执行'}</p></div>
  <div class="routecard"><h3>动态最早到达搜索</h3>${data.dynamic.found?renderLegs(data.dynamic.legs)+`<p><b>最早到达：${data.dynamic.arrivalClock}</b></p>`:'<p>无路径</p>'}</div>
  <div class="notice good">${esc(data.comparison?.explanation || '动态结果用于替代不可执行预制线。')}</div>`;
}

async function renderInterviews() {
  const data = await api('/api/interviews');
  $('#interviewList').innerHTML = data.interviews.map(i => {
    const segs = data.segments.filter(s=>s.interviewId===i.id);
    return `<div class="interview"><h3>${esc(i.title)}</h3><p>${esc(i.summary)}</p>${segs.map(s=>`<div class="segment"><b>${esc(s.title)}</b> <span class="pill">${esc(s.license)}</span><span class="pill ${s.publicPermission?'':'bad'}">${s.publicPermission?'公开':'局部撤权'}</span>
      <div>${s.cues.map(c=>`<div class="cue">${c.publicAudioStart ?? c.editedStart ?? c.sourceStart}s: ${esc(c.text)} <small>视频 ${c.videoStart??''}s</small></div>`).join('')}</div>
      <p><button onclick="cutSegment('${s.id}')">模拟剪掉 8–12 秒并重算时码</button> <button onclick="offsetSegment('${s.id}')">音画偏移 +0.25 秒</button> <button onclick="revokeSegment('${s.id}')">撤权</button></p></div>`).join('')}</div>`;
  }).join('');
  $('#trackPanel').innerHTML = data.tracks.map(t => t.status==='generated' ? `<div class="track"><h3>${esc(t.title)}</h3><p>${esc(t.license)} · ${t.durationSec}s · manifest v${t.manifestVersion}</p><ol>${t.items.map(it=>`<li>${it.startSec}s: ${esc(it.text)} <small>(video ${it.videoStartSec}s)</small></li>`).join('')}</ol><audio controls preload="none" src="/api/public-tracks/${t.id}.wav"></audio><p><small>WAV 为许可/同步占位预览音，不伪造完整口述音频。</small></p></div>` : `<div class="track withdrawn"><h3>${esc(t.segmentId)}</h3><p class="warning">公开音轨已撤回：${esc(t.reason)}</p></div>`).join('');
}
window.cutSegment = async id => { await api('/api/media/cut',{method:'POST',body:{segmentId:id,cutStart:8,cutEnd:12,reason:'演示剪辑：移除咳嗽声'}}); await renderInterviews(); };
window.offsetSegment = async id => { await api('/api/media/offset',{method:'POST',body:{segmentId:id,audioVideoOffset:0.25,reason:'演示音画同步校正'}}); await renderInterviews(); };
window.revokeSegment = async id => { await api('/api/media/license',{method:'POST',body:{segmentId:id,license:'restricted-family',publicPermission:false,licenseNote:'访谈对象撤回网络公开发布授权'}}); await renderInterviews(); };

$('#saveSnapshot').onclick = async () => { const d = await api('/api/offline/snapshot',{method:'POST',body:{}}); localStorage.setItem('offlineSnapshot', JSON.stringify(d.snapshot)); $('#offlineResult').textContent = `已保存 ${d.snapshot.id}\n内容 v${d.snapshot.versions.content} / 交通 v${d.snapshot.versions.transport}\n开放状态：cached-unverified，不是实时核实结果。`; };
$('#reconcile').onclick = async () => {
  const old = JSON.parse(localStorage.getItem('offlineSnapshot') || 'null');
  if (!old) return $('#offlineResult').textContent = '请先保存快照';
  const d = await api('/api/offline/reconcile',{method:'POST',body:{oldSnapshot:old}});
  localStorage.setItem('offlineSnapshot', JSON.stringify(d.snapshot));
  $('#offlineResult').textContent = JSON.stringify(d.diff, null, 2);
};
$('#exportList').onclick = async () => { const snap = JSON.parse(localStorage.getItem('offlineSnapshot')||'null'); if(!snap)return; const d=await api('/api/offline/exports/list',{method:'POST',body:{snapshot:snap}}); $('#offlineResult').textContent=JSON.stringify(d,null,2); };
$('#exportText').onclick = async () => { const snap = JSON.parse(localStorage.getItem('offlineSnapshot')||'null'); if(!snap)return; const r=await fetch('/api/offline/exports/text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:snap})}); $('#offlineResult').textContent=await r.text(); };
$('#exportPrint').onclick = async () => { const snap = JSON.parse(localStorage.getItem('offlineSnapshot')||'null'); if(!snap)return; const r=await fetch('/api/offline/exports/print-route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:snap,routeId:'route-day-canal',at:'2026-10-08T07:25:00.000Z'})}); $('#offlineResult').textContent=await r.text(); };

init().catch(err => { console.error(err); alert(err.message); });
