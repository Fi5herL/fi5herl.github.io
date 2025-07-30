# PowerNote Google Drive 同步 - 快速開始

## 🚀 快速啟動

### 第一次使用

選擇以下任一方式啟動本地伺服器：

#### 方法一：自動檢測 (推薦)
```
雙擊 start-powernote.bat
```
會自動檢測並使用 Node.js 或 Python

#### 方法二：指定 Node.js
```
雙擊 start-node.bat
```
或命令列：
```
node start-server.js
```

#### 方法三：指定 Python
```
雙擊 start.bat
```
或命令列：
```
python start-server.py
```

2. **瀏覽器會自動開啟** `http://localhost:8000`

3. **設置 Google Apps Script**
   - 參考 `GOOGLE_DRIVE_SYNC_SETUP.md` 完整指南

## 🔧 問題解決

### ❌ CORS 錯誤
```
Access to fetch at 'https://script.google.com/...' has been blocked by CORS policy
```

**解決方法：**
- ✅ 使用 `start-server.bat` 啟動本地伺服器
- ❌ 不要直接開啟 `index.html` 文件

### ❌ Python 未安裝
```
'python' is not recognized as an internal or external command
```

**解決方法：**
1. 下載並安裝 Python：https://www.python.org/downloads/
2. 安裝時勾選 "Add Python to PATH"
3. 重新啟動命令提示字元

## 📁 文件說明

| 文件 | 用途 |
|------|------|
| `start-server.bat` | Windows 一鍵啟動伺服器 |
| `start-server.py` | Python 本地伺服器腳本 |
| `google-drive-sync.js` | Google Apps Script 後端代碼 |
| `google-drive-client.js` | 前端同步客戶端 |
| `GOOGLE_DRIVE_SYNC_SETUP.md` | 詳細設置指南 |

## 🎯 使用流程

1. **啟動伺服器** → `start-server.bat`
2. **配置 GAS** → 參考設置指南
3. **開始同步** → 點擊藍色 Google Drive 按鈕

## 💡 提示

- 🌟 推薦使用本地伺服器運行，避免 CORS 問題
- 🔄 定期備份工作區到 Google Drive
- 📱 可在不同設備間同步筆記
- 🔒 所有數據存儲在你的個人 Google Drive

---

遇到問題？查看 `GOOGLE_DRIVE_SYNC_SETUP.md` 獲取詳細說明！