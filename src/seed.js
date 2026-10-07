export function createInitialState() {
  const now = '2026-10-07T08:00:00.000Z';
  const state = {
    meta: { schema: 1, createdAt: now, updatedAt: now },
    versions: { content: 1, transport: 1, announcements: 1 },
    places: [
      {
        id: 'p-old-lock', kind: 'lock', status: 'active', name: '老北闸',
        description: '京杭故道上的复线船闸，船工称“北闸口”。',
        evidence: '1953 航道图与船工访谈 I-001 互证。',
        waterDepthNote: ''
      },
      {
        id: 'p-west-dock', kind: 'dock', status: 'relocated', name: '新民码头（西岸）',
        description: '最早的煤炭与陶器装卸码头，1998 年因岸线整治迁至东岸。',
        evidence: '码头碑记、1987 年航运站台账。',
        waterDepthNote: ''
      },
      {
        id: 'p-east-dock', kind: 'dock', status: 'active', name: '新民码头（东岸）',
        description: '1998 年迁建后的今日游客码头；与西岸旧码头共享航运史身份但地理位置不同。',
        evidence: '迁建工程竣工资料。',
        waterDepthNote: ''
      },
      {
        id: 'p-gudao-dock', kind: 'dock', status: 'flooded', name: '孤岛码头',
        description: '1963 年大水后没入河滩，只能在枯水季看到木桩。',
        evidence: '口述史 I-002、1965 地形草图。',
        flooded: true,
        waterDepthNote: '常水位覆盖约 0.8 米；观景台设有安全边界。'
      },
      {
        id: 'p-xujia-dock', kind: 'dock', status: 'unlocated', name: '徐家埠码头',
        description: '家谱提到的临时码头，现存坐标尚未通过评审，地图以虚线表示“待定位”。',
        evidence: '徐氏家谱与田埂界石，暂缺航片。',
        waterDepthNote: ''
      },
      {
        id: 'p-north-granary', kind: 'granary', status: 'active', name: '北仓',
        description: '漕粮转运粮仓，现展陈量斗、斛板与船工工分册。',
        evidence: '仓房题记。',
        waterDepthNote: ''
      },
      {
        id: 'p-xujia-home', kind: 'home', status: 'active', name: '徐家船工旧居',
        description: '三代船工家庭访谈地点，保留灶间、缆结和账本。',
        evidence: '家庭访谈 I-003。',
        waterDepthNote: ''
      },
      {
        id: 'p-east-bridge', kind: 'bridge', status: 'active', name: '东桥绕行口',
        description: '船闸检修时的步行替代路线入口。',
        evidence: '今日交通导览。',
        waterDepthNote: ''
      },
      {
        id: 'p-chen-family', kind: 'home', status: 'active', name: '陈家河埠居所',
        description: '陈桂兰家庭访谈地点，讲述渡口夜航与等闸规矩。',
        evidence: '家庭访谈 I-002。',
        waterDepthNote: ''
      }
    ],
    nameRecords: [
      {
        id: 'nr-old-lock-bei', placeId: 'p-old-lock', name: '北闸口', language: 'zh', start: '1932', end: '1957',
        evidence: '老船工口称', status: 'historical', reviewedAt: now, reviewer: 'archivist', reviewNote: '作为旧称保留'
      }
    ],
    relations: [
      {
        id: 'rel-xinmin-relocated', fromPlaceId: 'p-west-dock', toPlaceId: 'p-east-dock',
        relation: 'relocated', start: '1998-05-01', end: null,
        evidence: '1998 迁建批复', status: 'approved', reviewedAt: now, reviewer: 'archivist',
        reviewNote: '身份连续但坐标不连续，历史事件仍指向西岸。', sourceDescription: '同一码头运营主体迁建'
      },
      {
        id: 'rel-xinmin-name', fromPlaceId: 'p-west-dock', toPlaceId: 'p-east-dock',
        relation: 'renamed', start: '1998-05-01', end: null,
        evidence: '航运站更名牌', status: 'approved', reviewedAt: now, reviewer: 'archivist',
        reviewNote: '“西岸/东岸”是区分后缀，不合并坐标。', sourceDescription: ''
      },
      {
        id: 'rel-gudao-flooded', fromPlaceId: 'p-gudao-dock', toPlaceId: null,
        relation: 'flooded', start: '1963-08', end: null,
        evidence: '1965 草图与口述', status: 'approved', reviewedAt: now, reviewer: 'archivist',
        reviewNote: '今点是安全观景台，不是原址。', sourceDescription: ''
      },
      {
        id: 'rel-same-name-xujia', fromPlaceId: 'p-xujia-dock', toPlaceId: 'p-xujia-home',
        relation: 'same-name-different-place', start: null, end: null,
        evidence: '地名普查中两处均带“徐家”', status: 'approved', reviewedAt: now, reviewer: 'archivist',
        reviewNote: '同名异址：码头待定位，旧居有明确坐标。', sourceDescription: '防止搜索时误并'
      },
      {
        id: 'rel-interview-chen', fromPlaceId: 'p-chen-family', toPlaceId: 'p-gudao-dock',
        relation: 'interview', start: '2024-04-12', end: null,
        evidence: '访谈知情同意书', status: 'approved', reviewedAt: now, reviewer: 'editor',
        reviewNote: '访谈地点与所谈淹没码头分离。', sourceDescription: ''
      }
    ],
    placeLocations: [
      { id: 'pl-old-lock', placeId: 'p-old-lock', status: 'confirmed', geometry: { x: 460, y: 170 }, validFrom: '1953-01-01', validTo: null, confidence: 'high', evidence: '航道图', reviewedAt: now, reviewer: 'archivist', reviewNote: '' },
      { id: 'pl-west-dock', placeId: 'p-west-dock', status: 'historical', geometry: { x: 170, y: 265 }, validFrom: '1921-01-01', validTo: '1998-05-01', confidence: 'high', evidence: '旧码头基础', reviewedAt: now, reviewer: 'archivist', reviewNote: '旧道路改线不移动此点' },
      { id: 'pl-east-dock', placeId: 'p-east-dock', status: 'confirmed', geometry: { x: 620, y: 300 }, validFrom: '1998-05-01', validTo: null, confidence: 'high', evidence: 'GPS', reviewedAt: now, reviewer: 'archivist', reviewNote: '' },
      { id: 'pl-gudao-view', placeId: 'p-gudao-dock', status: 'historical', geometry: { x: 300, y: 430 }, validFrom: '1880-01-01', validTo: '1963-08-01', confidence: 'medium', evidence: '木桩方位推算', reviewedAt: now, reviewer: 'archivist', reviewNote: '淹没遗址示意；今日观景台另有 visitor point' },
      { id: 'pl-xujia-proposed', placeId: 'p-xujia-dock', status: 'proposed', geometry: { x: 520, y: 470 }, validFrom: null, validTo: null, confidence: 'low', evidence: '界石距离推算', reviewedAt: null, reviewer: null, reviewNote: '' },
      { id: 'pl-north-granary', placeId: 'p-north-granary', status: 'confirmed', geometry: { x: 520, y: 105 }, validFrom: '1901-01-01', validTo: null, confidence: 'high', evidence: '仓房定位', reviewedAt: now, reviewer: 'archivist', reviewNote: '' },
      { id: 'pl-xujia-home', placeId: 'p-xujia-home', status: 'confirmed', geometry: { x: 735, y: 430 }, validFrom: '1928-01-01', validTo: null, confidence: 'high', evidence: '门牌 GPS', reviewedAt: now, reviewer: 'archivist', reviewNote: '' },
      { id: 'pl-east-bridge', placeId: 'p-east-bridge', status: 'confirmed', geometry: { x: 720, y: 170 }, validFrom: '2004-01-01', validTo: null, confidence: 'high', evidence: '道路图', reviewedAt: now, reviewer: 'archivist', reviewNote: '' },
      { id: 'pl-chen-family', placeId: 'p-chen-family', status: 'confirmed', geometry: { x: 245, y: 365 }, validFrom: '1949-01-01', validTo: null, confidence: 'high', evidence: '门牌 GPS', reviewedAt: now, reviewer: 'archivist', reviewNote: '' }
    ],
    events: [
      { id: 'e-1932-lock', date: '1932-06-09', endDate: null, title: '北闸口首次木闸门大修', summary: '船工以人力绞盘换闸，夜间在北仓领筹。', category: 'lock', placeId: 'p-old-lock', placeLocationId: 'pl-old-lock', sources: ['工分册残页', 'I-001'] },
      { id: 'e-1953-granary', date: '1953-10-18', endDate: null, title: '北仓秋季漕粮转运', summary: '27 条木船在新民码头候装，夜宿船上。', category: 'granary', placeId: 'p-north-granary', placeLocationId: 'pl-north-granary', sources: ['北仓台账'] },
      { id: 'e-1963-flood', date: '1963-08-07', endDate: '1963-08-15', title: '孤岛码头淹没', summary: '洪水冲走跳板，陈桂兰回忆母亲把灶火搬上船。', category: 'flood', placeId: 'p-gudao-dock', placeLocationId: 'pl-gudao-view', sources: ['I-002'] },
      { id: 'e-1978-night', date: '1978-11-02', endDate: null, title: '末班渡船夜过北闸', summary: '船工必须在鸣笛后靠左岸，等闸室放空再进。', category: 'ferry', placeId: 'p-old-lock', placeLocationId: 'pl-old-lock', sources: ['I-001'] },
      { id: 'e-1987-west', date: '1987-04-21', endDate: null, title: '西岸新民码头陶器堆场扩建', summary: '旧路沿堤岸通往堆场，后因改线废弃。', category: 'dock', placeId: 'p-west-dock', placeLocationId: 'pl-west-dock', sources: ['航运站台账'] },
      { id: 'e-1998-move', date: '1998-05-01', endDate: null, title: '新民码头迁至东岸', summary: '经营身份延续，旧码头坐标冻结在历史事件上。', category: 'dock', placeId: 'p-east-dock', placeLocationId: 'pl-east-dock', sources: ['迁建批复'] },
      { id: 'e-2009-road', date: '2009-09-30', endDate: null, title: '滨河路改线', summary: '当代道路绕行新区；旧事件仍在西岸堤岸坐标。', category: 'road', placeId: 'p-west-dock', placeLocationId: 'pl-west-dock', sources: ['市政道路图'] },
      { id: 'e-2024-family', date: '2024-04-12', endDate: null, title: '徐家三代船工访谈', summary: '在旧居灶间讲述解缆、过闸和粮仓工分。', category: 'interview', placeId: 'p-xujia-home', placeLocationId: 'pl-xujia-home', sources: ['I-003 授权书'] },
      { id: 'e-2026-visit', date: '2026-10-07', endDate: null, title: '今日故事站开放', summary: '游客从东岸新民码头出发，可步行北仓并预约渡口讲解。', category: 'visit', placeId: 'p-east-dock', placeLocationId: 'pl-east-dock', sources: ['运营公告'] }
    ],
    roads: [
      { id: 'road-old-embankment', label: '1987 堤岸老路（历史）', replacedRoadId: null, geometry: [{ x: 90, y: 310 }, { x: 170, y: 265 }, { x: 260, y: 240 }], openedAt: '1980-01-01', status: 'historical', note: '2009 后废弃；仍作为历史事件定位参照。' },
      { id: 'road-current-riverside', label: '2009 后滨河路（今日）', replacedRoadId: 'road-old-embankment', geometry: [{ x: 90, y: 350 }, { x: 250, y: 390 }, { x: 430, y: 370 }, { x: 620, y: 300 }], openedAt: '2009-09-30', status: 'current', note: '道路改线只改变今日导航，不回写旧事件。' }
    ],
    transitNodes: [
      { id: 'A', label: '东岸游客广场', pointId: 'vp-east-dock' },
      { id: 'B', label: '北仓门口', pointId: 'vp-granary' },
      { id: 'C', label: '左岸渡亭', pointId: 'vp-ferry-west' },
      { id: 'D', label: '老北闸讲解点', pointId: 'vp-lock' },
      { id: 'E', label: '东桥绕行口', pointId: 'vp-east-bridge' },
      { id: 'F', label: '旧居巷口', pointId: 'vp-xujia-home' },
      { id: 'G', label: '孤岛观景台', pointId: 'vp-gudao' }
    ],
    transitEdges: [
      {
        id: 'te-walk-A-B', mode: 'walk', from: 'A', to: 'B', distanceM: 720,
        windows: [{ start: '00:00', end: '23:59:59', serviceDate: 'same' }],
        durationSec: 600, note: '滨水步道全天开放'
      },
      {
        id: 'te-walk-A-E', mode: 'walk', from: 'A', to: 'E', distanceM: 500,
        windows: [{ start: '00:00', end: '23:59:59', serviceDate: 'same' }],
        durationSec: 420, note: '东桥步行连接线'
      },
      {
        id: 'te-walk-E-D', mode: 'walk', from: 'E', to: 'D', distanceM: 760,
        windows: [{ start: '00:00', end: '23:59:59', serviceDate: 'same' }],
        durationSec: 720, note: '船闸关闭时推荐绕行'
      },
      {
        id: 'te-walk-C-D-night', mode: 'walk', from: 'C', to: 'D', distanceM: 900,
        windows: [{ start: '05:00', end: '02:00', serviceDate: 'same' }],
        durationSec: 780, note: '05:00 至次日 02:00 的连续夜间窗口'
      },
      {
        id: 'te-walk-B-G', mode: 'walk', from: 'B', to: 'G', distanceM: 850,
        windows: [{ start: '08:00', end: '18:00', serviceDate: 'same' }],
        durationSec: 720, note: '观景台日间步道'
      },
      {
        id: 'te-walk-D-F', mode: 'walk', from: 'D', to: 'F', distanceM: 640,
        windows: [{ start: '06:00', end: '21:00', serviceDate: 'same' }],
        durationSec: 650, note: '巷弄步行线'
      },
      {
        id: 'te-ferry-B-C', mode: 'ferry', from: 'B', to: 'C', distanceM: 420,
        departures: ['07:45', '09:15', '13:20', '17:10'],
        durationSec: 480, minTransferSec: 120, note: '末班为白天班；跨午夜另见夜渡'
      },
      {
        id: 'te-ferry-B-C-night', mode: 'ferry', from: 'B', to: 'C', distanceM: 420,
        departures: ['23:30'], durationSec: 2700, minTransferSec: 120,
        note: '23:30 开船，00:15 到左岸（跨午夜）'
      },
      {
        id: 'te-lock-C-D', mode: 'lock', from: 'C', to: 'D', distanceM: 320,
        windows: [{ start: '06:00', end: '20:00', serviceDate: 'same' }],
        durationSec: 600, minTransferSec: 120, note: '讲解船队随船闸批次通过'
      }
    ],
    prebuiltRoutes: [
      {
        id: 'route-day-canal',
        name: '上午预制：码头—北仓—渡口—船闸',
        from: 'A', to: 'D',
        legs: [
          { edgeId: 'te-walk-A-B' },
          { edgeId: 'te-ferry-B-C', intendedDeparture: '07:45' },
          { edgeId: 'te-lock-C-D' }
        ]
      },
      {
        id: 'route-lock-detour',
        name: '船闸检修绕行：东桥步行',
        from: 'A', to: 'D',
        legs: [{ edgeId: 'te-walk-A-E' }, { edgeId: 'te-walk-E-D' }]
      },
      {
        id: 'route-night-cross',
        name: '夜间跨午夜：北仓—夜渡—老北闸',
        from: 'B', to: 'D',
        legs: [{ edgeId: 'te-ferry-B-C-night', intendedDeparture: '23:30' }, { edgeId: 'te-walk-C-D-night' }]
      }
    ],
    visitorPoints: [
      { id: 'vp-east-dock', placeId: 'p-east-dock', nodeId: 'A', name: '东岸游客码头', open: true, openHours: '08:00-18:00', services: ['售票','无障碍厕所'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' },
      { id: 'vp-granary', placeId: 'p-north-granary', nodeId: 'B', name: '北仓展陈点', open: true, openHours: '09:00-17:00', services: ['展览','饮水'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' },
      { id: 'vp-ferry-west', placeId: 'p-old-lock', nodeId: 'C', name: '左岸渡亭', open: true, openHours: '07:30-18:00', services: ['遮雨','时刻表'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' },
      { id: 'vp-lock', placeId: 'p-old-lock', nodeId: 'D', name: '老北闸讲解点', open: true, openHours: '08:00-17:30', services: ['讲解','闸室观览'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' },
      { id: 'vp-east-bridge', placeId: 'p-east-bridge', nodeId: 'E', name: '东桥绕行口', open: true, openHours: '00:00-23:59', services: ['绕行标识'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' },
      { id: 'vp-xujia-home', placeId: 'p-xujia-home', nodeId: 'F', name: '徐家旧居预约点', open: false, openHours: '预约开放', services: ['家庭访谈展'], lastVerifiedAt: '2026-10-06T12:00:00.000Z' },
      { id: 'vp-gudao', placeId: 'p-gudao-dock', nodeId: 'G', name: '孤岛码头安全观景台', open: true, openHours: '08:00-18:00', services: ['望远镜','安全围栏'], lastVerifiedAt: '2026-10-07T07:30:00.000Z' }
    ],
    announcements: [
      {
        id: 'ann-seasonal', kind: 'info', title: '秋季讲解每小时一场', body: '北仓至老北闸讲解受船闸批次影响。',
        affectsEdges: [], affectsPoints: [], effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2026-10-31T23:59:59.000Z', publishedAt: now, active: true
      }
    ],
    interviews: [
      {
        id: 'I-001', title: '周宝山：听闸铃长大', speaker: '周宝山', birthYear: 1942, placeId: 'p-old-lock',
        recordedAt: '2024-03-08', curator: '林音', consent: 'signed', summary: '讲述木闸门、绞盘和夜渡规矩。'
      },
      {
        id: 'I-002', title: '陈桂兰：洪水那年的跳板', speaker: '陈桂兰', birthYear: 1938, placeId: 'p-chen-family',
        recordedAt: '2024-04-12', curator: '林音', consent: 'signed', summary: '讲述孤岛码头淹没、家庭迁离与母亲的灶火。'
      },
      {
        id: 'I-003', title: '徐秀兰：一家人的缆结', speaker: '徐秀兰', birthYear: 1955, placeId: 'p-xujia-home',
        recordedAt: '2024-05-02', curator: '何舟', consent: 'signed', summary: '讲述码头工分、粮仓票据和旧居生活。'
      }
    ],
    mediaSegments: [
      {
        id: 'ms-001-intro', interviewId: 'I-001', title: '闸铃声从哪里来', sourceStart: 0, sourceEnd: 42, sourceDuration: 42,
        durationAfterEdits: 42, license: 'CC BY 4.0', publicPermission: true, licenseNote: '可公开，需署名。',
        audioVideoOffset: 0, cues: [
          { id: 'c1', sourceStart: 0, sourceEnd: 8, text: '我小时候，闸铃一响就知道船要进闸。', speaker: '周宝山' },
          { id: 'c2', sourceStart: 12, sourceEnd: 21, text: '绞盘要四个人配合，谁也不能乱绳。', speaker: '周宝山' },
          { id: 'c3', sourceStart: 28, sourceEnd: 39, text: '夜里过闸，先听声音，再看灯。', speaker: '周宝山' }
        ], edits: []
      },
      {
        id: 'ms-001-family', interviewId: 'I-001', title: '父亲的工分册', sourceStart: 42, sourceEnd: 92, sourceDuration: 50,
        durationAfterEdits: 50, license: 'restricted-family', publicPermission: false, licenseNote: '仅家庭与档案馆内部研究，不生成公开音轨。',
        audioVideoOffset: 0, cues: [
          { id: 'c4', sourceStart: 3, sourceEnd: 15, text: '这一段涉及在世亲属评价，暂不公开。', speaker: '档案员备注' }
        ], edits: []
      },
      {
        id: 'ms-002-flood', interviewId: 'I-002', title: '洪水与跳板', sourceStart: 0, sourceEnd: 66, sourceDuration: 66,
        durationAfterEdits: 66, license: 'CC BY-NC 4.0', publicPermission: true, licenseNote: '可公开非商用；片段化许可不覆盖整张原始录音。',
        audioVideoOffset: 0, cues: [
          { id: 'c5', sourceStart: 0, sourceEnd: 10, text: '水上来的时候，跳板先漂走了。', speaker: '陈桂兰' },
          { id: 'c6', sourceStart: 18, sourceEnd: 33, text: '母亲把灶火搬到船上，说饭不能断。', speaker: '陈桂兰' },
          { id: 'c7', sourceStart: 45, sourceEnd: 61, text: '现在看水，只记得木桩顶在浪里晃。', speaker: '陈桂兰' }
        ], edits: []
      },
      {
        id: 'ms-003-knot', interviewId: 'I-003', title: '缆结和粮仓票', sourceStart: 0, sourceEnd: 58, sourceDuration: 58,
        durationAfterEdits: 58, license: 'CC BY-SA 4.0', publicPermission: true, licenseNote: '公开，相同方式共享。',
        audioVideoOffset: 0.75, cues: [
          { id: 'c8', sourceStart: 4, sourceEnd: 16, text: '这个结叫活扣，船一晃也不能散。', speaker: '徐秀兰' },
          { id: 'c9', sourceStart: 30, sourceEnd: 44, text: '北仓的票是竹牌，回来再换工分。', speaker: '徐秀兰' }
        ], edits: [
          { id: 'edit-offset-seed', at: now, kind: 'av-offset', audioVideoOffset: 0.75, reason: '采集设备音画偏移校正' }
        ]
      }
    ],
    publicTracks: [
      trackFromSegment('ms-001-intro'),
      trackFromSegment('ms-002-flood'),
      trackFromSegment('ms-003-knot')
    ],
    snapshots: []
  };
  return withOriginalCues(state);
}

function withOriginalCues(state) {
  for (const seg of state.mediaSegments) seg.originalCues = JSON.parse(JSON.stringify(seg.cues));
  return state;
}

function trackFromSegment(segmentId) {
  const at = '2026-10-07T08:00:00.000Z';
  return {
    id: `track-${segmentId}`,
    segmentId,
    status: 'generated',
    generatedAt: at,
    license: null,
    items: [],
    manifestVersion: 1
  };
}
