# 运河船工故事站

一个从零实现、无运行时第三方依赖的全栈演示：时间轴与 SVG 地图联动，展示码头、船闸、粮仓和家庭访谈；后端用事件日志持久保存“历史地点身份”和“今日参观点”的区别。

## 运行

```bash
npm start
# 重置演示数据
RESET_DATA=1 npm start
# 访问 http://localhost:3000
```

## 验收测试

```bash
npm test
```

7 组端到端/领域验收覆盖：

1. 更名、迁建、淹没、同名异址均形成可审阅关联；道路改线不回写旧事件坐标。
2. 预制路线检查与时间窗动态最早到达：错过 07:45 渡船时给出换乘解释，动态搜索改到 09:15。
3. 23:30 夜渡跨 00:15 抵达，连续夜间步行窗口正确跨午夜。
4. 船闸临时关闭阻断预制线，动态搜索改走东桥步行替代线。
5. 片段局部撤权撤回公开音轨；剪辑/音画偏移后逐字稿与公开时码从源时间码重新派生。
6. 旧地点待定位、同名异址、淹没遗址与今日安全观景台分离。
7. 离线收藏分内容/交通双版本，重连只替换变化分区；列表、无图阅读和打印路线从同一快照导出，不把缓存开放状态展示成实时已核实。路线查询期间发布公告会被异步搜索观察、重启并使用更新网络。

## 数据模型要点

- `places`：稳定身份，如“新民码头”运营身份。
- `placeLocations`：身份在某个时期的坐标；`proposed` 是待定位，`historical` 是冻结的历史位置，`confirmed` 是已核实现位点。
- `relations`：更名、迁建、淹没、同名异址、访谈等关联，带证据、审阅状态、审阅意见。
- `events.placeLocationId`：事件永远指向其发生时的位置版本；道路今日改线只新增 road/交通边，不修改此值。
- `visitorPoints`：今日参观点，含开放状态、服务、最后核实时间；历史身份与今日开放状态分开。
- `events.jsonl`：仅追加审计事件；`state.json`：原子替换快照，重启后可继续审阅和查询。

## 路径算法

- 步行/船闸使用带跨午夜能力的时间窗。
- 渡口使用显式班表，记录跨午夜到达。
- 登船强制 `minTransferSec`，避免“07:44 到、07:45 开”被错误判定为可换乘。
- `/api/routes/prebuilt/check` 检查预制路线的原计划可行性并给出阻断/错过原因。
- `/api/routes/earliest` 使用时间依赖 Dijkstra 求最早到达；搜索循环会轮询公告版本，查询期间公告更新时重启。
- `/api/routes/compare` 同时返回两者和差异解释。

## 媒体许可

许可以片段为单位，而不是整张原始访谈：

- `publicPermission=true` 且许可证为公开许可时，生成公开音轨 manifest 和可审计 WAV 占位预览。
- 撤权后公开音轨状态为 `withdrawn`，不提供 WAV。
- 剪辑以 sourceStart/sourceEnd 为不可变源时间码；删除区间按累计移除秒数重算 editedStart/publicAudioStart。
- 音画偏移只改视频参考时码，公开音频轨保持自己的时间线。

## 离线快照

快照分为：

- `content`：历史地点、事件、访谈、公开音轨等，内容版本更新时替换。
- `transport`：交通边、预制路线、今日参观点、公告，交通/公告版本更新时替换。

重连 diff 后只替换受影响分区。所有导出都记录快照 ID、保存时间和 stale warning；缓存中的开放点始终是 `cached-unverified` / `liveCheckedAt:null`。

## 主要 API

- `GET /api/map`、`GET /api/timeline`
- `GET /api/places/:id`
- `POST /api/places/names`、`POST /api/places/names/review`
- `POST /api/places/relations`、`POST /api/places/relations/review`
- `POST /api/places/locations`、`POST /api/places/locations/review`
- `POST /api/roads/reroute`
- `POST /api/routes/prebuilt/check`、`POST /api/routes/earliest`、`POST /api/routes/compare`
- `POST /api/announcements`
- `POST /api/media/license|cut|offset|tracks/regenerate`
- `POST /api/offline/snapshot|reconcile|diff`
- `POST /api/offline/exports/list|text|print-route`
