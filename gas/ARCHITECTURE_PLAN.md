# GAS LINE Webhook 系統架構規劃

> **狀態**：架構規劃草案（Architecture Planning）  
> **作者**：Fi5herL  
> **更新**：2026-03-24

---

## 目錄

1. [目標與非目標](#1-目標與非目標)
2. [系統分層架構](#2-系統分層架構)
3. [資料流設計](#3-資料流設計)
4. [Script Properties 機密管理策略](#4-script-properties-機密管理策略)
5. [可靠性機制](#5-可靠性機制)
6. [Trigger 策略](#6-trigger-策略)
7. [手動強制同步設計](#7-手動強制同步設計)
8. [觀測與告警計畫](#8-觀測與告警計畫)
9. [MVP 分期推出計畫](#9-mvp-分期推出計畫)
10. [批次參數基線](#10-批次參數基線)

---

## 1. 目標與非目標

### ✅ 目標

- 以 GAS（Google Apps Script）取代大部分 n8n 自動化流程
- LINE Webhook 快速回應（< 1.2 秒），不阻塞任何重工作業
- 支援文字、圖片、檔案訊息同步到 Google Sheets / Google Drive
- 支援手動觸發 `force sync`（GET endpoint 或 LINE 指令）
- 支援打開 Google Sheet 時自動入佇列（`onOpen` enqueue）
- 所有密碼 / API token 一律存放於 **Script Properties**，不寫死在程式碼
- 支援每日觀測報告、錯誤告警

### ❌ 非目標（本期不做）

- 即時雙向串流（GAS 無法長連線）
- 完整 CI/CD 自動部署 GAS（手動貼上即可）
- 支援超過 5,000 訊息/天的高流量場景（超出請考慮拆服務）
- 多租戶 / 多 LINE Channel 支援

---

## 2. 系統分層架構

```
┌─────────────────────────────────────────────────────────────────┐
│  LINE Platform                                                  │
│  (sends webhook events: message, postback, follow...)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS POST
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — Ingress（同步，< 1.2 秒）                            │
│  doPost(e)                                                      │
│  • 驗簽 (HMAC-SHA256 with LINE_CHANNEL_SECRET)                  │
│  • 解析最小欄位（type, messageId, groupId, userId, ts）         │
│  • 寫入事件佇列（event_queue sheet，status=pending）            │
│  • 立即回 HTTP 200                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │ 非同步（時間觸發 / 手動觸發）
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 — Queue（資料緩衝）                                    │
│  Google Sheet: event_queue / media_queue / sync_queue           │
│  欄位：id, type, payload_json, status, retry_count,             │
│         next_retry_at, created_at, updated_at                   │
└────────┬───────────────┬───────────────┬────────────────────────┘
         │               │               │
         ▼               ▼               ▼
┌────────────┐  ┌────────────────┐  ┌──────────────────┐
│  Layer 3a  │  │   Layer 3b     │  │   Layer 3c       │
│  Event     │  │   Media        │  │   Sync           │
│  Worker    │  │   Worker       │  │   Worker         │
│            │  │                │  │                  │
│ • 路由指令 │  │ • 抓 LINE      │  │ • 執行 forceSync │
│ • 寫 Logs  │  │   Content API  │  │ • 回傳統計       │
│ • 批次     │  │ • 上傳 Drive   │  │                  │
│   appendRow│  │ • 回填 URL     │  │                  │
└─────┬──────┘  └───────┬────────┘  └────────┬─────────┘
      │                 │                    │
      ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4 — Output                                               │
│  • Google Sheets（logs_curr / summary / todos / dead_letter）   │
│  • Google Drive（媒體檔案，按群組/日期分層資料夾）              │
│  • LINE reply/push（指令回應、sync 完成通知）                   │
└─────────────────────────────────────────────────────────────────┘
```

### 檔案清單（實作時建立）

| 檔案 | 職責 |
|------|------|
| `Config.gs` | 所有常數與 Script Properties 讀取，含 `getConfig()` |
| `Webhook.gs` | `doPost(e)` — 驗簽、解析、入佇列、回 200 |
| `Queue.gs` | 佇列讀寫工具：`enqueue / dequeue / markDone / markRetry / markDead` |
| `Workers.gs` | `processEventQueue / processMediaQueue / processSyncQueue` |
| `Admin.gs` | `doGet(e)` — forceSync endpoint、`onOpen(e)` enqueue |
| `Utils.gs` | 共用工具：HMAC 驗簽、JSON 包裝、日誌輸出 |

---

## 3. 資料流設計

### 3-A. Webhook 快路徑（Fast Path）

```
LINE → doPost → 驗簽 → 解析 → sheet.appendRow(pending) → return 200
                                                          ↑
                         目標完成時間 < 1,200 ms ─────────┘
```

**規則**：
- 不在 doPost 做任何 Drive / AI / Fetch 操作
- 指令型（`/a`, `/d`, `/help`）也先入佇列，由 worker 路由後再回覆

### 3-B. Event Queue 處理流程

```
processEventQueue()
  1. ScriptLock 取鎖（防併發）
  2. 讀取 event_queue WHERE status='pending' ORDER BY created_at ASC LIMIT QUEUE_BATCH_SIZE
  3. 逐筆處理：
     a. 文字訊息 → appendRows 到 logs_curr（批次）
     b. 指令訊息 → 路由到對應處理函數
     c. media 訊息 → 搬到 media_queue（status=pending）
  4. 成功：status=done
     失敗：retry_count++, next_retry_at = now + backoff, status=retry
     超限：status=dead → appendRow 到 dead_letter sheet
  5. 釋放鎖
```

### 3-C. Media Pipeline（兩段式，不漏檔）

```
Stage 1（webhook 層）：
  收到 image/file/video/audio event
  → 記錄 media_queue: {message_id, media_type, status=pending, created_at}
  → 立即回 200（不下載）

Stage 2（media worker，每 1 分鐘）：
  → 取最舊 pending 筆（MEDIA_BATCH_SIZE 筆）
  → 呼叫 LINE Content API 抓檔案（token 有效期 ~30 分鐘內）
  → 上傳到 Google Drive（分層資料夾）
  → 回填 drive_file_id, drive_url, status=done
  → 失敗則 retry / dead_letter
```

**保險參數**：
- `MEDIA_FETCH_MAX_DELAY_MIN = 30`（超過 30 分 pending 視為高風險，告警）
- `MEDIA_RETRY_MAX = 5`，指數退避

### 3-D. Sync Queue

```
觸發來源：
  - doGet?action=forceSync  （手動）
  - onOpen(e)               （打開 Sheet，enqueue）
  - LINE 指令 /sync now     （可選）

processSyncQueue():
  → 讀 sync_queue WHERE status=pending
  → 依序呼叫 flushEventQueue(200) + flushMediaQueue(30)
  → 回傳統計：{synced_events, synced_media, failed, remaining_backlog}
  → LINE push 通知（若有 ADMIN_USER_ID）
```

---

## 4. Script Properties 機密管理策略

> ⚠️ **所有密碼、Token 一律存 Script Properties，絕不硬碼在程式碼中。**

### 必填 Properties

| Key | 說明 | 範例 |
|-----|------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API 長效 token | `AbCd...` |
| `LINE_CHANNEL_SECRET` | 驗簽用 secret | `1a2b3c...` |
| `FORCE_SYNC_AUTH_TOKEN` | forceSync GET 端點的認證 token | 隨機 32 字元 |
| `SPREADSHEET_ID_LOGS` | 主日誌試算表 ID | `1BxiM...` |
| `DRIVE_ROOT_FOLDER_ID` | Drive 媒體根資料夾 ID | `1Bx...` |
| `ENV` | 環境標識 | `dev` 或 `prod` |

### 選填 Properties

| Key | 說明 | 建議預設 |
|-----|------|----------|
| `SPREADSHEET_ID_TASKS` | 任務/佇列試算表（若獨立） | 同 LOGS 或空 |
| `AI_API_KEY` | AI 摘要 API Key | — |
| `AI_API_BASE_URL` | AI API 基底 URL | `https://api.openai.com` |
| `AI_MODEL` | AI 模型名稱 | `gpt-4o-mini` |
| `ADMIN_USER_ID` | LINE userId，接收告警推播 | — |

### getConfig() 設計原則

```javascript
function getConfig() {
  const p = PropertiesService.getScriptProperties();
  const required = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET',
                    'FORCE_SYNC_AUTH_TOKEN', 'SPREADSHEET_ID_LOGS',
                    'DRIVE_ROOT_FOLDER_ID'];
  required.forEach(key => {
    if (!p.getProperty(key))
      throw new Error(
        `Missing Script Property: "${key}". ` +
        `Please set it via Apps Script Editor → Project Settings → Script Properties.`
      );
  });
  // 日誌只記錄「是否存在」，不輸出 token 值
  return {
    lineToken:       p.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    lineSecret:      p.getProperty('LINE_CHANNEL_SECRET'),
    forceSyncToken:  p.getProperty('FORCE_SYNC_AUTH_TOKEN'),
    spreadsheetId:   p.getProperty('SPREADSHEET_ID_LOGS'),
    driveFolderId:   p.getProperty('DRIVE_ROOT_FOLDER_ID'),
    env:             p.getProperty('ENV') || 'dev',
    adminUserId:     p.getProperty('ADMIN_USER_ID') || '',
    aiApiKey:        p.getProperty('AI_API_KEY') || '',
  };
}
```

---

## 5. 可靠性機制

### 5-A. 冪等性（Idempotency）

- 每筆事件以 `message_id`（LINE 提供，全局唯一）為主鍵
- 寫入前先查是否已存在（`SHEET_WRITE_DEDUP_WINDOW_SEC = 120`）
- Worker 處理前先標記 `status=processing`，防止重複拾取

### 5-B. 重試與指數退避

```
重試策略（QUEUE_RETRY_BACKOFF_SEC）：
  第 1 次失敗 → 等 30 秒
  第 2 次失敗 → 等 120 秒
  第 3 次失敗 → 等 300 秒（5 分）
  第 4 次失敗 → 等 900 秒（15 分）
  第 5 次失敗 → 等 1800 秒（30 分）
  第 6 次以上 → 進 dead_letter
```

### 5-C. Dead-Letter Queue

- `dead_letter` sheet：保存失敗超限的事件
- 欄位：`id, type, payload, error_msg, failed_at, source_queue`
- 每日報告輸出 dead_letter 筆數
- 可手動重新入佇列或人工處理

### 5-D. 分散式鎖（Lock）

```javascript
// worker 進入點標準模式
const lock = LockService.getScriptLock();
if (!lock.tryLock(5000)) {
  Logger.log('[WARN] Lock busy, skip this run');
  return;
}
try {
  // ... 處理邏輯
} finally {
  lock.releaseLock();
}
```

### 5-E. Cooldown（防抖）

| 機制 | 參數 | 預設值 |
|------|------|--------|
| Force sync 冷卻 | `FORCE_SYNC_COOLDOWN_SEC` | 60 秒 |
| onOpen 冷卻 | `OPEN_SYNC_COOLDOWN_SEC` | 60 秒 |
| 同指令防抖 | `COMMAND_DEBOUNCE_SEC` | 8 秒 |
| 同群 AI 冷卻 | `AI_COOLDOWN_PER_GROUP_MIN` | 20 分 |

---

## 6. Trigger 策略

### 時間觸發（Time-driven）

| Trigger | 函數 | 頻率 | 說明 |
|---------|------|------|------|
| Event Worker | `processEventQueue` | 每 1 分鐘 | 主要文字/指令批次 |
| Media Worker | `processMediaQueue` | 每 1 分鐘 | 媒體下載/上傳 |
| Sync Worker | `processSyncQueue` | 每 1 分鐘 | 消化 sync_queue |
| AI Summary | `processAiSummary` | 每 10 分鐘 | 群組摘要批次（可選） |
| Daily Report | `sendDailyReport` | 每日 23:00 | 統計報告 |

### onOpen Enqueue（打開 Sheet 時）

```javascript
function onOpen(e) {
  const p = PropertiesService.getDocumentProperties();
  const last = Number(p.getProperty('last_open_sync_ts') || 0);
  const now = Date.now();
  if (now - last < OPEN_SYNC_COOLDOWN_SEC * 1000) return; // 冷卻中

  p.setProperty('last_open_sync_ts', String(now));
  enqueue_('sync_queue', { source: 'onOpen', ts: now });
  // 不在 onOpen 做重工作，只入佇列
}
```

> **注意**： `onOpen` 只在「Simple Trigger」模式執行，無法使用需授權的 API（如 UrlFetch）。Worker 才執行真正的同步。

### Trigger 設置函數

```javascript
function setupAllTriggers() {
  // 先清除舊 triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processEventQueue')
    .timeBased().everyMinutes(1).create();

  ScriptApp.newTrigger('processMediaQueue')
    .timeBased().everyMinutes(1).create();

  ScriptApp.newTrigger('processSyncQueue')
    .timeBased().everyMinutes(1).create();

  ScriptApp.newTrigger('processAiSummary')
    .timeBased().everyMinutes(10).create();

  ScriptApp.newTrigger('sendDailyReport')
    .timeBased().atHour(23).everyDays(1).create();
}
```

---

## 7. 手動強制同步設計

### 7-A. Web App 端點

```
GET https://script.google.com/macros/s/<deployment_id>/exec
    ?action=forceSync
    &token=<FORCE_SYNC_AUTH_TOKEN>
```

### 7-B. 流程

```javascript
function doGet(e) {
  const action = e.parameter.action || '';
  const token  = e.parameter.token  || '';

  if (action === 'forceSync') return handleForceSync_(token);
  return json_({ ok: true, status: 'idle' });
}

function handleForceSync_(token) {
  const cfg = getConfig();

  // 1. 驗證 token
  if (token !== cfg.forceSyncToken)
    return json_({ ok: false, error: 'unauthorized' });

  // 2. Cooldown 檢查
  const p = PropertiesService.getScriptProperties();
  const last = Number(p.getProperty('last_force_sync_ts') || 0);
  if (Date.now() - last < FORCE_SYNC_COOLDOWN_SEC * 1000)
    return json_({ ok: false, error: 'cooldown', retry_after: FORCE_SYNC_COOLDOWN_SEC });

  // 3. 取鎖
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000))
    return json_({ ok: false, error: 'busy' });

  p.setProperty('last_force_sync_ts', String(Date.now()));

  try {
    const r1 = flushEventQueue_(200);
    const r2 = flushMediaQueue_(30);
    return json_({
      ok: true,
      synced_events:    r1.done,
      synced_media:     r2.done,
      failed_count:     r1.fail + r2.fail,
      remaining_backlog: getBacklog_()
    });
  } finally {
    lock.releaseLock();
  }
}
```

### 7-C. 安全參數

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `FORCE_SYNC_COOLDOWN_SEC` | `60` | 1 分鐘只能觸發一次 |
| `FORCE_SYNC_MAX_RUNTIME_SEC` | `50` | 避免 GAS 6 分鐘超時 |
| `FORCE_SYNC_AUTH_TOKEN` | Script Property | 必填，32+ 字元隨機字串 |

---

## 8. 觀測與告警計畫

### 8-A. 每日報告欄位（23:00 推播）

```
📊 每日系統報告 ({{date}})
────────────────────
✅ 事件處理: {{events_done}} / {{events_in}} 筆
⚠️  重試中: {{events_retry}} 筆
💀 Dead-letter: {{events_dead}} 筆
────────────────────
📸 Media 處理: {{media_done}} / {{media_in}} 筆
📋 Backlog (pending): {{backlog}} 筆
────────────────────
🤖 AI 摘要: {{ai_runs}} 次，平均 {{ai_avg_ms}} ms
────────────────────
⏱ 平均處理延遲: {{avg_lag_sec}} 秒
```

### 8-B. 即時告警門檻

| 指標 | 告警條件 | 參數 |
|------|----------|------|
| 錯誤率 | > 5% | `ERROR_RATE_ALERT_THRESHOLD = 0.05` |
| 佇列延遲 | > 5 分鐘 | `QUEUE_LAG_ALERT_SEC = 300` |
| Media pending 超時 | > 30 分鐘 | `MEDIA_FETCH_MAX_DELAY_MIN = 30` |
| Dead-letter 新增 | 任何新增 | 立即推播 |

### 8-C. 日誌安全原則

- 日誌**不輸出任何 token 或密碼**，只記錄「是否存在（exists: true/false）」
- 每筆處理記錄：`timestamp, type, message_id, status, elapsed_ms`
- AI 相關：只記錄 token 用量，不記錄訊息原文（或加 hash）

---

## 9. MVP 分期推出計畫

### Phase 1 — 核心 Webhook + 批次寫入（最優先）

- [ ] `Config.gs`：`getConfig()` + Script Properties 驗證
- [ ] `Utils.gs`：HMAC 驗簽、`json_()` 包裝
- [ ] `Webhook.gs`：`doPost(e)` 驗簽 → 入 event_queue → 回 200
- [ ] `Queue.gs`：`enqueue_ / dequeue_ / markDone_ / markRetry_ / markDead_`
- [ ] `Workers.gs`：`processEventQueue()` — 批次 appendRows 到 logs_curr
- [ ] `setupAllTriggers()` — 每分鐘 trigger
- [ ] 測試：本地手動呼叫 `doPost` with mock event

### Phase 2 — Media Pipeline

- [ ] media_queue sheet 建立
- [ ] `processMediaQueue()` — 抓 LINE Content → 上傳 Drive → 回填
- [ ] Drive 資料夾分層邏輯（按群組/年月）
- [ ] Media dead-letter 機制
- [ ] `MEDIA_FETCH_MAX_DELAY_MIN` 告警

### Phase 3 — Force Sync + onOpen + 觀測

- [ ] `Admin.gs`：`doGet(e)` forceSync endpoint
- [ ] `onOpen(e)` enqueue
- [ ] `sendDailyReport()` — LINE push 每日統計
- [ ] 即時告警（error rate, queue lag）
- [ ] dead_letter sheet 監控

### Phase 4 — AI 摘要批次化（可選）

- [ ] `processAiSummary()` — 每 10 分鐘，每次最多 3 群
- [ ] `AI_COOLDOWN_PER_GROUP_MIN` 冷卻
- [ ] AI token 用量記錄
- [ ] AI 摘要結果寫入 summary sheet

---

## 10. 批次參數基線

以下為建議的 GAS 批次/同步參數預設值，統一存放於 `Config.gs`：

```javascript
// Config.gs — 常數（不含機密，機密在 Script Properties）

const BATCH = {
  // Webhook 層
  WEBHOOK_MAX_MS:              1200,   // 強制 1.2 秒回 200
  REPLY_MODE:                  'fast', // 指令即時查，其他先入佇列

  // Event Queue
  QUEUE_FLUSH_INTERVAL_SEC:    30,     // 批次間最小間隔 30 秒（trigger 每分鐘執行，此值供 worker 內部節流參考）
  QUEUE_BATCH_SIZE:            50,     // 一次最多 50 筆
  QUEUE_MAX_RETRY:             5,
  QUEUE_RETRY_BACKOFF_SEC:     [30, 120, 300, 900, 1800],

  // Sheets 寫入
  SHEET_APPEND_BATCH_SIZE:     100,    // appendRows 一次 100 筆
  SHEET_READ_CACHE_TTL_SEC:    60,     // /a /d 查詢快取 60 秒
  SHEET_WRITE_DEDUP_WINDOW_SEC:120,    // 同 message_id 2 分內不重複寫

  // Media
  MEDIA_INLINE_PROCESS:        false,  // webhook 不做下載/上傳
  MEDIA_WORKER_INTERVAL_SEC:   60,     // 每分鐘跑 media worker
  MEDIA_BATCH_SIZE:            10,     // 每次最多 10 個檔案
  MEDIA_MAX_FILE_MB:           25,     // 超過標記 deferred
  MEDIA_DRIVE_FOLDER_CACHE_TTL_SEC: 3600,
  MEDIA_FETCH_MAX_DELAY_MIN:   30,     // 超過告警
  MEDIA_RETRY_MAX:             5,
  MEDIA_RETRY_BACKOFF_SEC:     [60, 300, 900, 1800, 3600],

  // AI 摘要
  AI_TRIGGER_MODE:             'scheduled',
  AI_SUMMARY_INTERVAL_MIN:     10,
  AI_GROUP_BATCH_SIZE:         3,
  AI_MAX_INPUT_CHARS:          12000,
  AI_COOLDOWN_PER_GROUP_MIN:   20,
  AI_TIMEOUT_SEC:              25,

  // 限流
  COMMAND_DEBOUNCE_SEC:        8,
  USER_RATE_LIMIT_PER_MIN:     20,
  GROUP_RATE_LIMIT_PER_MIN:    120,

  // Force Sync
  FORCE_SYNC_COOLDOWN_SEC:     60,
  FORCE_SYNC_MAX_RUNTIME_SEC:  50,

  // onOpen
  OPEN_SYNC_COOLDOWN_SEC:      60,

  // 觀測
  ERROR_RATE_ALERT_THRESHOLD:  0.05,   // 5% 失敗告警
  QUEUE_LAG_ALERT_SEC:         300,    // 佇列延遲 > 5 分告警
  DAILY_REPORT_TIME:           '23:00',
};
```

---

## 系統流量極限（參考）

| 場景 | 安全值 | 可接受上限 | 高風險 |
|------|--------|-----------|--------|
| 訊息量 | 1,000 則/天 | 3,000 則/天 | 5,000+ |
| 尖峰 | ≤ 10 則/分 | ≤ 30 則/分 | 50+/分 |
| 負載指數 L（text×1 + image×4 + file×6 + ai×12） | L < 800/天 | 800–2,000 | > 2,000 |

---

*下一步：確認此架構後，開始 Phase 1 實作（`Config.gs` → `Webhook.gs` → `Queue.gs` → `Workers.gs`）。*
