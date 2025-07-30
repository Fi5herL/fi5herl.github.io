# PowerNote Google Drive 同步設置指南

## 概述

這個同步機制允許你將PowerNote的工作區備份到Google Drive，並在不同設備間同步筆記和設定。

## 重要提醒

⚠️ **由於瀏覽器的CORS (跨域資源共享) 安全限制，Google Drive同步功能無法直接從本地文件 (file://) 運行。**

請使用以下任一方法：

### 方法一：使用本地開發伺服器 (推薦)
1. 雙擊 `start-server.bat` (Windows) 或執行 `python start-server.py`
2. 瀏覽器會自動開啟 `http://localhost:8000`
3. 現在可以正常使用Google Drive同步功能

### 方法二：部署到網頁伺服器
- 將整個PowerNote資料夾上傳到網頁伺服器（如GitHub Pages、Netlify等）
- 透過 https:// 協議存取

## 設置步驟

### 1. 創建Google Apps Script項目

1. 前往 [Google Apps Script](https://script.google.com/)
2. 點擊「新建項目」
3. 將項目命名為「PowerNote Drive Sync」

### 2. 部署後端腳本

1. 刪除預設的 `Code.gs` 內容
2. 將 `google-drive-sync.js` 的內容複製並貼到 `Code.gs` 中
3. 儲存項目 (Ctrl+S)

### 3. 設置權限

1. 點擊「執行」按鈕來觸發權限授權
2. 允許腳本存取你的Google Drive
3. 確認所有必要的權限

### 4. 部署Web應用程式

1. 點擊「部署」→「新增部署作業」
2. 選擇類型：「網頁應用程式」
3. 描述：「PowerNote Drive Sync API」
4. 執行身分：「我」
5. 存取對象：「知道連結的使用者」
6. 點擊「部署」
7. **重要：複製「網頁應用程式URL」**

### 5. 配置前端

1. 打開 `google-drive-client.js`
2. 找到這行：
   ```javascript
   const GAS_DEPLOYMENT_URL = 'YOUR_GAS_DEPLOYMENT_URL_HERE';
   ```
3. 將 `YOUR_GAS_DEPLOYMENT_URL_HERE` 替換為步驟4中複製的URL
4. 儲存文件

### 6. 測試功能

1. 在PowerNote中創建一些筆記
2. 點擊Google Drive上傳按鈕（藍色按鈕）
3. 確認上傳成功
4. 點擊Google Drive下載按鈕
5. 確認可以看到版本列表

## 功能說明

### 上傳功能
- 自動創建「NoteConfig.md」資料夾在你的Google Drive根目錄
- 上傳包含所有筆記、設定和時間記錄的工作區文件
- 文件命名格式：`PowerNote-Workspace-YYYY-MM-DD-HH-mm-ss.json`

### 下載功能
- 顯示所有備份版本的列表
- 顯示上傳時間和文件大小
- 一鍵恢復任何歷史版本
- 安全確認對話框防止意外覆蓋

### 數據結構
備份的工作區包含：
- 所有筆記文件和內容
- 計時器歷史記錄
- 用戶設定（字體大小、主題等）
- LocalStorage數據

## 安全性說明

- 所有數據存儲在你的個人Google Drive中
- 只有你能存取這些備份文件
- 腳本使用你的Google帳戶權限，不會與第三方共享數據
- 建議定期檢查Google Drive中的「NoteConfig.md」資料夾

## 故障排除

### 常見問題

**Q: 出現 CORS 錯誤 "Access to fetch has been blocked by CORS policy"**
A: 這是最常見的問題。解決方案：
   - 使用 `start-server.bat` 啟動本地伺服器
   - 不要直接開啟 index.html 文件
   - 確保從 http://localhost:8000 存取 PowerNote

**Q: 上傳或下載時出現權限錯誤**
A: 重新授權Google Apps Script的權限，確保允許存取Google Drive

**Q: 找不到版本列表**
A: 檢查Google Drive中是否存在「NoteConfig.md」資料夾，確認至少上傳過一次

**Q: 無法連接到後端**
A: 確認GAS_DEPLOYMENT_URL設置正確，檢查網路連接

**Q: 上傳的文件損壞**
A: 確認PowerNote中有實際的筆記數據，檢查瀏覽器控制台是否有錯誤

**Q: Python 伺服器無法啟動**
A: 確保已安裝 Python 3.x，從 https://www.python.org/downloads/ 下載安裝

### 測試後端腳本

在Google Apps Script編輯器中，你可以運行 `testSyncService()` 函數來測試基本功能：

1. 選擇 `testSyncService` 函數
2. 點擊執行按鈕
3. 查看執行日誌確認沒有錯誤

## 高級設置

### 修改資料夾名稱
在 `google-drive-sync.js` 中修改：
```javascript
const CONFIG_FOLDER_NAME = 'Your-Custom-Folder-Name';
```

### 修改文件前綴
```javascript
const WORKSPACE_FILE_PREFIX = 'Your-Custom-Prefix-';
```

## 更新說明

當PowerNote有更新時：
1. 更新前端代碼後，同步功能可能需要重新配置
2. 如果後端腳本有更新，需要重新部署Google Apps Script
3. 確保備份重要數據後再進行更新

## 支援

如有問題，請檢查：
1. 瀏覽器開發者工具的控制台錯誤
2. Google Apps Script的執行日誌
3. Google Drive中的「NoteConfig.md」資料夾內容

---

設置完成後，你就可以在不同設備間輕鬆同步PowerNote的工作區了！