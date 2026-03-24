# LINE Bot → GAS Migration Plan

## 1. 系統目標與範圍

### 目標
將現有 n8n + LINE 系統遷移到 Google Apps Script（GAS），以降低維運複雜度，並利用 GAS 免費資源執行 LINE 訊息的接收、儲存、媒體搬運與 AI 摘要等工作流程。

### 範圍
| 功能 | 優先 | 說明 |
|---|---|---|
| Webhook 接收 LINE events | P0 | doPost 快速回應 |
| 事件寫入 Google Sheets | P0 | event_queue + log |
| 媒體（圖片/檔案）非同步搬運 | P0 | pending → Drive |
| 手動強制同步 | P0 | doGet?action=forceSync |
| onOpen 觸發排程同步 | P1 | 開 Sheet 時輕量觸發 |
| AI 摘要排程 | P2 | 每 10 分鐘批次 |
| LINE 指令即時回覆（/a /d /help） | P1 | 特定指令快速查 |

---

## 2. 架構

```
LINE Platform
  │  POST webhook event
  ▼
[doPost] ─── 快速 ACK (200 OK) ──────────────────────────────
  │
  ▼
event_queue (Google Sheet tab)
  │  status: pending
  ▼
[processEventQueue] ─── time trigger (每 30 秒)
  │
  ├─── text event（含指令）→ handleTextEvent
  │     ├── 指令型 (/a /d /help) → 即時查 Sheet + LINE reply
  │     └── 一般訊息 → append logs
  │
  ├─── media event → 寫入 media_queue (status: pending)
  │
  └─── other (sticker/join/leave) → append logs

[processMediaQueue] ─── time trigger (每 60 秒)
  │  status: pending → downloading → done/retry_n/dead_letter
  └── LINE getContent API → Drive upload → update status

[forceSync] ─── doGet?action=forceSync&token=xxx
  └── flushEventQueue + flushMediaQueue + 回傳摘要

[onOpen] ─── Spreadsheet onOpen trigger
  └── debounce 60 秒，寫入 _system_queue → worker 處理
```

### 設計原則
- **webhook 層只做 enqueue，不做任何重工作**
- **所有密碼 / API token 放在 GAS Script Properties，程式碼零硬寫**
- **每筆事件帶 idempotency key（message_id / event_id）**
- **所有寫入操作用 appendRows（批次）而非逐筆**

---

## 3. 資料模型

### 3.1 event_queue（Sheet tab）

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | string | UUID (v4-like) |
| event_id | string | LINE event.webhookEventId |
| message_id | string | event.message.id（可為空） |
| received_at | timestamp | 收到時間 |
| event_type | string | message / follow / join / leave |
| message_type | string | text / image / file / sticker / video |
| source_type | string | user / group / room |
| source_id | string | userId / groupId / roomId |
| user_id | string | userId |
| text | string | 文字內容（image 等為空） |
| status | string | pending / processing / done / error |
| retry_count | number | 已重試次數 |
| last_error | string | 最後錯誤訊息 |
| processed_at | timestamp | 處理完成時間 |

### 3.2 media_queue（Sheet tab）

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | string | UUID |
| event_id | string | 關聯的 event_id |
| message_id | string | LINE message_id（用來抓媒體） |
| media_type | string | image / file / video / audio |
| source_id | string | 群組或用戶 ID |
| received_at | timestamp | 收到時間 |
| status | string | pending / downloading / done / dead_letter |
| retry_count | number | 重試次數 |
| drive_file_id | string | 上傳後 Drive file ID |
| drive_url | string | 上傳後分享連結 |
| file_size_bytes | number | 檔案大小 |
| last_error | string | 錯誤訊息 |
| processed_at | timestamp | 完成時間 |

### 3.3 sync_log（Sheet tab）

| 欄位 | 型別 | 說明 |
|---|---|---|
| timestamp | timestamp | 操作時間 |
| trigger | string | webhook / timer / forceSync / onOpen |
| events_processed | number | 本次處理事件數 |
| media_processed | number | 本次處理媒體數 |
| failed_count | number | 失敗數 |
| duration_ms | number | 執行時間 |
| notes | string | 備註 |

### 3.4 dead_letter（Sheet tab）

超過 QUEUE_MAX_RETRY 的事件移到此處，供人工審視。結構同 event_queue，加 `dead_at` 欄位。

---

## 4. Runtime / Config 策略

### 4.1 所有 secrets 放 Script Properties

在 GAS 編輯器：**專案設定 → 指令碼屬性**

| Key | 說明 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API Channel Access Token |
| `LINE_CHANNEL_SECRET` | LINE Channel Secret（用於 signature 驗證） |
| `SPREADSHEET_ID` | 主要 Google Sheets ID（存 queue / log） |
| `DRIVE_MEDIA_FOLDER_ID` | 媒體上傳目標 Drive 資料夾 ID |
| `FORCE_SYNC_AUTH_TOKEN` | 手動強制同步的存取 token |
| `NOTIFY_USER_ID` | （選填）推送通知的 LINE userId |
| `AI_API_KEY` | （選填）AI 摘要 API Key（P2） |
| `AI_API_ENDPOINT` | （選填）AI API URL（P2） |

### 4.2 非機密參數（程式碼內 CONFIG）

| 參數 | 預設值 | 說明 |
|---|---|---|
| `WEBHOOK_MAX_MS` | 1200 | webhook 最大允許執行時間（ms） |
| `QUEUE_FLUSH_INTERVAL_SEC` | 30 | event queue flush 週期 |
| `QUEUE_BATCH_SIZE` | 50 | 單次處理事件數上限 |
| `QUEUE_MAX_RETRY` | 5 | 最大重試次數 |
| `QUEUE_RETRY_BACKOFF_SEC` | [30,120,300,900,1800] | 指數退避（秒） |
| `MEDIA_WORKER_INTERVAL_SEC` | 60 | media worker 週期 |
| `MEDIA_BATCH_SIZE` | 10 | 單次搬運媒體數上限 |
| `MEDIA_MAX_FILE_MB` | 25 | 超過此大小標記 deferred |
| `FORCE_SYNC_COOLDOWN_SEC` | 60 | 手動同步最小間隔 |
| `FORCE_SYNC_MAX_RUNTIME_SEC` | 50 | 強制同步最大執行時間 |
| `COMMAND_DEBOUNCE_SEC` | 8 | 同 user 同指令去重窗口 |
| `SHEET_APPEND_BATCH_SIZE` | 100 | appendRows 每次最多筆數 |
| `SHEET_WRITE_DEDUP_WINDOW_SEC` | 120 | 同 message_id 去重窗口 |
| `AI_SUMMARY_INTERVAL_MIN` | 10 | AI 摘要排程週期（分鐘） |
| `AI_COOLDOWN_PER_GROUP_MIN` | 20 | 同群 AI 摘要最小間隔 |

---

## 5. Sync 策略

### 5.1 正常批次排程（Primary）

```
Event Timer (每 30 秒)  →  processEventQueue()
Media Timer (每 60 秒)  →  processMediaQueue()
```

### 5.2 手動強制同步

```
GET https://.../exec?action=forceSync&token=<FORCE_SYNC_AUTH_TOKEN>
  → 取 ScriptLock
  → flushEventQueue(200)
  → flushMediaQueue(30)
  → 回傳 JSON 摘要
```

### 5.3 onOpen 觸發（選用）

```
Spreadsheet onOpen()
  → 防抖 60 秒
  → 寫入 _system_queue 一筆 force_sync 任務
  → (worker 下一輪吃掉，不在 onOpen 直接跑重工作)
```

---

## 6. 可靠性策略

### 6.1 重試與退避

```
retry_count 0 → 立即重試
retry_count 1 → 30 秒後
retry_count 2 → 120 秒後
retry_count 3 → 300 秒後
retry_count 4 → 900 秒後
retry_count 5 → dead_letter
```

### 6.2 Dead-Letter

- 超過 `QUEUE_MAX_RETRY` 的事件移入 `dead_letter` sheet
- 保留原始 payload + 錯誤訊息
- 可手動重新入隊（將 status 改回 pending）

### 6.3 Idempotency

- 每個 event 用 `message_id` 或 `event_id` 作為 dedup key
- 寫入前先查 `SHEET_WRITE_DEDUP_WINDOW_SEC` 秒內是否已有相同 id

### 6.4 Concurrency

- `processEventQueue` 和 `processMediaQueue` 使用 `LockService.getScriptLock()`
- `forceSync` 也取同一把 lock，確保不同任務不會同時操作同一批資料

### 6.5 媒體抓取時效

- LINE 媒體內容有效期有限，建議 **30 分鐘內完成抓取**
- `processMediaQueue` 優先處理最舊的 pending 項目
- 超過 `MEDIA_FETCH_MAX_DELAY_MIN`（預設 30 分鐘）的項目標記 expired

---

## 7. 流量估算與極限

| 類型 | 安全量 | 可撐量 | 極限 |
|---|---|---|---|
| 訊息數 | 1,000 則/天 | 3,000 則/天 | 5,000+ 則/天 |
| 尖峰 | ≤10 則/分 | ≤30 則/分 | >50 則/分 |
| 負載指數 L | <800/天 | 800~2000/天 | >2000/天 |

`L = text×1 + image×4 + file×6 + ai_trigger×12`

你目前約 35~70 則/天，遠低於安全量。

---

## 8. 測試計劃

### 8.1 單元測試（手動在 GAS 編輯器執行）

| 函式 | 測試方式 |
|---|---|
| `testConfig()` | 驗證所有 Script Properties 已設定 |
| `testEnqueueEvent()` | 手動寫一筆假事件進 event_queue |
| `testProcessEventQueue()` | 手動觸發 worker，驗證狀態更新 |
| `testEnqueueMedia()` | 手動寫一筆假媒體任務進 media_queue |
| `testForceSync()` | 呼叫 forceSync_，驗證回傳 JSON |
| `testOnOpen()` | 呼叫 onOpen()，驗證 _system_queue 有新資料 |
| `testLineSignature()` | 用已知 body + secret 驗證 HMAC |

### 8.2 整合測試

1. 部署 Web App（Test 版本）
2. 用 curl / Postman 模擬 LINE webhook 送 POST
3. 確認 event_queue 有新資料（status=pending）
4. 手動執行 `processEventQueue()`
5. 確認 status 更新為 done
6. 測試 `?action=forceSync&token=xxx` 回傳摘要
7. 測試 `?action=forceSync&token=wrong` 回傳 401

### 8.3 推出階段

| 階段 | 內容 |
|---|---|
| Phase 0 | 建立 Spreadsheet + 設定 Script Properties + 跑 testConfig() |
| Phase 1 | 部署 webhook，LINE 訊息寫入 event_queue（只 log，不 reply） |
| Phase 2 | 啟用 processEventQueue worker，verify logs |
| Phase 3 | 啟用 processMediaQueue worker，verify Drive uploads |
| Phase 4 | 啟用指令回覆（/a /d /help） |
| Phase 5 | 啟用 AI 摘要（可選） |

---

## 9. MVP 完成標準

- [x] Config 讀取所有 secrets 自 Script Properties（無硬寫值）
- [x] doPost 收到 webhook → 入隊 → 回 200（≤1.2 秒）
- [x] processEventQueue worker（scaffolded，可手動執行）
- [x] processMediaQueue worker（scaffolded，可手動執行）
- [x] doGet?action=forceSync 帶 token 驗證 + lock + cooldown
- [x] onOpen handler（debounced，只寫 _system_queue）
- [x] Logger wrapper（INFO / WARN / ERROR）
- [x] 基本測試函式（testConfig, testEnqueueEvent, testForceSync）
