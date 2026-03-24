# LINE Bot GAS — 設定說明與使用手冊

`LineBotWebhook.js` 是一個 Google Apps Script，用於接收 LINE webhook 事件、非同步搬運媒體到 Google Drive，並提供手動強制同步與 onOpen 觸發功能。

---

## 系統架構（快覽）

```
LINE Platform
  │ POST /exec (webhook)
  ▼
[doPost]  ── 快速 ACK ─── event_queue (Sheet)
                                │
                    [processEventQueue]  ← 每分鐘 timer
                                │
                    ┌───────────┤
                  text       media event
                    │           │
              handleText    media_queue (Sheet)
                                │
                    [processMediaQueue]  ← 每分鐘 timer
                                │
                         Drive folder
```

---

## 必要的 Script Properties（指令碼屬性）

在 GAS 編輯器：**專案設定 → 指令碼屬性** 新增以下金鑰（**請勿將 token/密碼寫進程式碼**）：

| 金鑰 | 說明 | 必填 |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API Channel Access Token | ✅ |
| `LINE_CHANNEL_SECRET` | LINE Channel Secret（用於 signature 驗證） | ✅ |
| `SPREADSHEET_ID` | 主要 Google Sheets ID（event_queue / media_queue / log 都在這裡） | ✅ |
| `DRIVE_MEDIA_FOLDER_ID` | 媒體上傳目標 Google Drive 資料夾 ID | ✅ |
| `FORCE_SYNC_AUTH_TOKEN` | 手動強制同步的存取 token（自訂一個隨機字串） | ✅ |
| `NOTIFY_USER_ID` | （選填）推送通知的 LINE userId | ❌ |
| `AI_API_KEY` | （選填）AI 摘要 API Key（Phase 5） | ❌ |
| `AI_API_ENDPOINT` | （選填）AI API URL（Phase 5） | ❌ |

---

## 快速設定步驟

### 1. 建立 Google Spreadsheet

1. 開啟 [sheets.google.com](https://sheets.google.com/) → 建立新試算表
2. 記下 URL 中的 Spreadsheet ID（`/d/<SPREADSHEET_ID>/edit`）
3. 不需要手動建立 tabs，程式會自動建立：
   - `event_queue` — 接收到的 LINE 事件
   - `media_queue` — 待搬運的媒體任務
   - `sync_log` — 同步紀錄
   - `dead_letter` — 失敗超過重試上限的事件
   - `_system_queue` — onOpen / /sync 觸發的任務

### 2. 建立 Google Drive 媒體資料夾

1. 在 Drive 建立一個資料夾（例如 `LINE_media`）
2. 取得資料夾 ID（URL 中 `folders/<FOLDER_ID>`）

### 3. 取得 LINE API 設定

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 選擇你的 Messaging API channel
3. 取得：
   - **Channel access token（long-lived）**
   - **Channel secret**

### 4. 建立 GAS 專案

1. 開啟 [script.google.com](https://script.google.com/) → 建立新專案
2. 貼上 `LineBotWebhook.js` 的全部內容
3. 專案名稱可命名為 `LINE Bot Webhook`

### 5. 設定 Script Properties

1. GAS 編輯器 → **專案設定**（左側齒輪圖示）→ **指令碼屬性**
2. 逐一新增上方表格中的必填金鑰與對應值

### 6. 驗證設定

在 GAS 編輯器執行：
```
testConfig()
```
確認所有必填 Properties 都已設定（執行記錄應顯示 `ALL REQUIRED PROPERTIES SET ✓`）。

### 7. 部署為 Web App（Webhook endpoint）

1. GAS 編輯器 → **部署** → **新增部署**
2. 類型選 **Web 應用程式**
3. 設定：
   - **執行身分**：自己（你的 Google 帳號）
   - **具有存取權的使用者**：所有人（LINE 需要公開存取）
4. 取得部署 URL（格式：`https://script.google.com/macros/s/<DEPLOY_ID>/exec`）

### 8. 設定 LINE Webhook URL

1. LINE Developers Console → 你的 channel → Messaging API
2. **Webhook URL** 貼入步驟 7 的 URL
3. 點選 **驗證（Verify）** — 應顯示成功

### 9. 設定時間觸發器

在 GAS 編輯器執行一次：
```
setupTriggers()
```
這會設定：
- `processEventQueue` — 每分鐘執行（處理文字/指令事件）
- `processMediaQueue` — 每分鐘執行（搬運圖片/檔案到 Drive）

---

## 手動強制同步

當你想立刻查看最新訊息，使用以下 URL 觸發強制同步：

```
GET https://script.google.com/macros/s/<DEPLOY_ID>/exec?action=forceSync&token=<FORCE_SYNC_AUTH_TOKEN>
```

回應範例：
```json
{
  "ok": true,
  "trigger": "forceSync",
  "synced_events": 12,
  "failed_events": 0,
  "remaining_events": 0,
  "synced_media": 3,
  "failed_media": 0,
  "remaining_media": 0,
  "duration_ms": 2341
}
```

**注意**：強制同步有 60 秒 cooldown（避免誤操作打太快）。

---

## onOpen 自動觸發同步

當你開啟 Google Spreadsheet 時，可以自動觸發同步：

1. GAS 編輯器 → **觸發器**（左側時鐘圖示）→ **新增觸發器**
2. 設定：
   - 執行函式：`onOpen`
   - 事件來源：來自試算表
   - 事件類型：開啟時

**注意**：`onOpen` 只會把任務「加入排程」，不會立刻執行重工作，避免卡住 UI。實際同步由 worker 函式在下一輪觸發時完成。

---

## 查詢系統狀態

```
GET https://.../exec?action=status&token=<FORCE_SYNC_AUTH_TOKEN>
```

---

## 測試函式（可在 GAS 編輯器直接執行）

| 函式 | 說明 |
|---|---|
| `testConfig()` | 驗證所有必填 Script Properties 已設定 |
| `testEnqueueEvent()` | 模擬一筆文字事件入隊，確認 event_queue sheet |
| `testEnqueueMediaEvent()` | 模擬一筆圖片事件入隊，確認 media_queue 路由 |
| `testProcessEventQueue()` | 手動執行事件 worker，確認狀態更新 |
| `testProcessMediaQueue()` | 手動執行媒體 worker（需要真實 LINE token） |
| `testForceSync()` | 手動執行強制同步，確認回傳 JSON |
| `testOnOpen()` | 模擬開啟試算表，確認 _system_queue 新增資料 |
| `testLineSignature()` | 驗證 HMAC 簽名邏輯正確 |

---

## 測試流程（建議順序）

1. **Phase 0**：執行 `testConfig()` — 確認設定
2. **Phase 1**：執行 `testEnqueueEvent()` → 查看 event_queue sheet 有新資料
3. **Phase 2**：執行 `testProcessEventQueue()` → 查看 event_queue status 更新為 done
4. **Phase 3**：執行 `testEnqueueMediaEvent()` → `testProcessEventQueue()` → 查看 media_queue 有 pending
5. **Phase 4**：部署 Web App → 用 curl 模擬 LINE webhook → 驗證全端流程

---

## 模擬 LINE Webhook（用 curl 測試）

```bash
# 模擬一筆文字事件（不含 signature 驗證）
curl -X POST "https://script.google.com/macros/s/<DEPLOY_ID>/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "webhookEventId": "test001",
      "replyToken": "test-reply-token",
      "type": "message",
      "source": {"type": "user", "userId": "Utest123"},
      "message": {"id": "msg001", "type": "text", "text": "/help"}
    }]
  }'
```

預期回應：
```json
{"ok": true, "queued": 1}
```

---

## 常見問題

**Q: webhook 一直 timeout？**  
A: 確認 GAS Web App 已部署為「所有人可存取」。GAS doPost 不支援認證。

**Q: media_queue 一直 pending？**  
A: 確認 `LINE_CHANNEL_ACCESS_TOKEN` 正確，且 LINE 媒體在 30 分鐘內才能下載。

**Q: Script Properties 怎麼設定？**  
A: GAS 編輯器左側齒輪「專案設定」→ 往下捲到「指令碼屬性」→ 新增屬性。

**Q: forceSync 說 cooldown？**  
A: 1 分鐘內只能觸發一次強制同步，稍後再試。

---

## 安全性說明

- 所有 API token / channel secret 都只存在 **GAS Script Properties**，**絕不寫進程式碼**。
- `doGet` 需要正確的 `FORCE_SYNC_AUTH_TOKEN` 才能執行（返回 403）。
- LINE webhook signature 驗證已實作，非 LINE 送的請求會被拒絕（需設定 `LINE_CHANNEL_SECRET`）。
- 媒體 URL 取得後立即上傳 Drive，不會在 GAS 長期儲存媒體內容。
