# GAS Publisher — 設定說明

## 功能

`GDocPublisher.js` 是一個 Google Apps Script，負責將 Google Docs 文章自動轉換成 Markdown 並推送到 GitHub，觸發 GitHub Actions 重新建置 AstroPaper 靜態網站。

```
Google Docs（Drive 資料夾）
  ↓ GAS 腳本轉換
Markdown + AstroPaper frontmatter
  ↓ GitHub API commit
src/data/blog/*.md
  ↓ GitHub Actions 自動觸發
AstroPaper 靜態網站建置
  ↓ deploy-pages
https://fi5herl.github.io（快速讀取，無 API 呼叫）
```

---

## 快速設定步驟

### 1. 建立 GitHub Personal Access Token

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. 選擇 Repository: `Fi5herL/fi5herl.github.io`
3. 權限：`Contents` → Read and write
4. 複製 token（以 `github_pat_` 開頭）

### 2. 建立 Google Apps Script 專案

1. 開啟 [script.google.com](https://script.google.com/) → 建立新專案
2. 貼上 `GDocPublisher.js` 的全部內容
3. 專案名稱可命名為 `Fi5her Blog Publisher`

### 3. 設定 Script Properties（機密設定）

在 GAS 編輯器中：**檔案 → 專案屬性 → 指令碼屬性**

| 金鑰 | 值 |
|---|---|
| `GITHUB_TOKEN` | 你的 GitHub token（步驟 1）|
| `BLOG_FOLDER_ID` | Google Drive 文章資料夾 ID |
| `LOG_SHEET_ID` | （選填）Google Sheets ID 供發布紀錄 |

**如何取得 Drive 資料夾 ID？**  
開啟資料夾，URL 為 `drive.google.com/drive/folders/`**`<FOLDER_ID>`**

### 4. 執行一次初始化

在 GAS 編輯器中執行：
```
setupTrigger()   ← 設定每小時自動發布
```

或手動執行：
```
publishAll()     ← 立即發布資料夾中的所有文章
```

---

## Google Docs 文章格式

### 標題
使用 Google Docs 的**標題 1 / 標題 2** 樣式（會對應到 Markdown `#` / `##`）。

文件名稱 = 文章標題（可加日期前綴，例如 `2025-08-01 我的文章`）。

### 特殊指令（文件最前面幾行）

在文件開頭（前 5 段）可加入：

```
description: 這篇文章在說什麼...
tags: 技術, 生活, 工具
featured: true
draft: true
sortOrder: 1
```

`sortOrder` 為整數，數字越小越靠前（當部落格設定 `defaultSort: "pinned-date"` 時生效）。

### 圖片

直接在 Google Docs 中插入圖片（**插入 → 圖片**）即可。
腳本會自動：
1. 將圖片上傳至 GitHub `public/blog/images/<slug>-<序號>.<副檔名>`
2. 在 Markdown 中插入 `![image](/blog/images/...)` 圖片標籤

> ⚠️ 每次重新發布文章時，圖片會被重新上傳覆蓋（不會累積舊圖片）。

### 跳過草稿

文件名稱以 `_` 開頭（例如 `_草稿 測試`）→ 腳本會跳過不發布。

---

## 手動觸發 API

部署為 Web App 後，可透過 URL 觸發：

```
# 發布全部
GET https://script.google.com/macros/s/<DEPLOY_ID>/exec?action=publishAll

# 發布單篇（文件 ID）
GET https://script.google.com/macros/s/<DEPLOY_ID>/exec?action=publishOne&fileId=<DOC_ID>
```

---

## 啟用 GitHub Pages

> ⚠️ 必須在 GitHub 儲存庫設定中切換 Pages 來源為 **GitHub Actions**，部署工作流程才能生效。

1. 前往 `https://github.com/Fi5herL/fi5herl.github.io/settings/pages`
2. Source → 選擇 **GitHub Actions**
3. 儲存後，下次 push 到 `main` 就會自動部署

---

## 工具箱頁面（Tools）

部落格已內建 **工具箱** 頁面（`/tools`），可以在導覽列直接進入。

### 新增工具

編輯 `src/data/tools.ts`，在 `TOOLS` 陣列中加入一個物件：

```ts
{
  name: "我的工具名稱",
  desc: "工具的簡短說明",
  href: "/blog/myTool.html",   // 靜態 HTML 放在 public/ 目錄下
  tags: ["分類1", "分類2"],
}
```

工具頁支援依標籤篩選，點選頁面上方的標籤按鈕即可過濾。

---

## 文章排序設定

### 預設排序

在 `src/config.ts` 的 `defaultSort` 欄位可設定：

| 值 | 說明 |
|---|---|
| `"date-desc"` | 依日期新→舊排序（原始預設） |
| `"pinned-date"` | 有 `sortOrder` 的文章優先（數字小→大），其餘依日期新→舊 |

### 文章自訂排序

在 Markdown frontmatter 加入 `sortOrder` 整數欄位：

```yaml
---
sortOrder: 1   # 1 = 最優先；省略此欄表示不釘選
---
```

透過 GAS 發布的文章，可在文件開頭加：

```
sortOrder: 1
```
