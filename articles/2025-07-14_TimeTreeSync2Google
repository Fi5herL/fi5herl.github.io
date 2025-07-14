---
title: TimeTree Sync to Google Calendar
date: 2025-07-14
---

> 不想學習如何架設腳本程式碼可以直接安裝[油猴插件](https://www.tampermonkey.net/index.php?locale=zh#download)，並且點擊此連結安裝[TimeTree同步Google腳本](https://github.com/Fi5herL/TempermonkeyScript/raw/refs/heads/main/TimeTree2GoogleCalendar.user.js)

### **總覽**

這個專案分為兩個核心部分：

1.  **Google Apps Script (後端服務)**：一個運行在 Google 雲端的程式，負責接收指令並安全地操作你的 Google 日曆。
2.  **油猴腳本 (Tampermonkey) (前端工具)**：一個安裝在你瀏覽器上的擴充功能腳本，它會在 TimeTree 網站上加入一個按鈕，讓你一鍵觸發同步。

---

### **第一部分：設定 Google Apps Script (後端服務)**

這是整個系統的大腦，負責所有實際的日曆操作。

#### **步驟 1.1：安裝與建立專案**

1.  **前往 Google Apps Script 網站**：點擊此連結 [https://script.google.com/home](https://script.google.com/home)。
2.  **建立新專案**：點擊左上角的「**+ 新專案**」。
3.  **命名專案**：點擊左上角的「未命名專案」，將其改為一個你好記的名稱，例如 `TimeTree 全功能同步`。

#### **步驟 1.2：貼上後端程式碼**

1.  **清空預設程式碼**：將編輯器中 `Code.gs` 檔案裡的所有內容刪除。
2.  **貼上新程式碼**：將下面**完整**的程式碼複製並貼到編輯器中。

```javascript
// --- 設定 ---
const CALENDAR_ID = 'YOUR_CALENDAR_ID'; // 待會需要替換成你的日曆 ID

// --- 顏色匹配邏輯 ---
const GOOGLE_COLOR_PALETTE = {
  PALE_BLUE:   { hex: '#5484ed', enum: CalendarApp.EventColor.PALE_BLUE },   // 1
  PALE_GREEN:  { hex: '#51b749', enum: CalendarApp.EventColor.PALE_GREEN },  // 2
  MAUVE:       { hex: '#b741d0', enum: CalendarApp.EventColor.MAUVE },       // 3
  PALE_RED:    { hex: '#dc2127', enum: CalendarApp.EventColor.PALE_RED },    // 4
  YELLOW:      { hex: '#fad165', enum: CalendarApp.EventColor.YELLOW },      // 5
  ORANGE:      { hex: '#ffad46', enum: CalendarApp.EventColor.ORANGE },      // 6
  CYAN:        { hex: '#46d6db', enum: CalendarApp.EventColor.CYAN },        // 7
  GRAY:        { hex: '#e1e1e1', enum: CalendarApp.EventColor.GRAY },        // 8
  BLUE:        { hex: '#5484ed', enum: CalendarApp.EventColor.BLUE },        // 9
  GREEN:       { hex: '#51b749', enum: CalendarApp.EventColor.GREEN },       // 10
  RED:         { hex: '#dc2127', enum: CalendarApp.EventColor.RED },         // 11
};

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function colorDistance(rgb1, rgb2) {
  const rDiff = rgb1.r - rgb2.r;
  const gDiff = rgb1.g - rgb2.g;
  const bDiff = rgb1.b - rgb2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

function getClosestGoogleColor(hex) {
  if (!hex) return null;
  const inputRgb = hexToRgb(hex);
  if (!inputRgb) return null;

  let closestColor = null;
  let minDistance = Infinity;

  for (const colorName in GOOGLE_COLOR_PALETTE) {
    const paletteColor = GOOGLE_COLOR_PALETTE[colorName];
    const paletteRgb = hexToRgb(paletteColor.hex);
    const distance = colorDistance(inputRgb, paletteRgb);
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = paletteColor.enum;
    }
  }
  return closestColor;
}

// --- 主函式 (V3 - 包含顏色同步) ---
function doPost(e) {
  try {
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!calendar) return createJsonResponse({ status: 'error', message: '找不到指定的日曆 ID。' });

    const payload = JSON.parse(e.postData.contents);
    const timeTreeEvents = payload.events;
    const viewStartDate = new Date(payload.viewStartDate);
    const viewEndDate = new Date(payload.viewEndDate);
    
    const googleEvents = calendar.getEvents(viewStartDate, viewEndDate);
    const googleEventMap = new Map();
    googleEvents.forEach(gEvent => {
      const eventDateStr = gEvent.getStartTime().toISOString().split('T')[0];
      const key = `${gEvent.getTitle()}_${eventDateStr}`;
      googleEventMap.set(key, gEvent);
    });

    let addedCount = 0, skippedCount = 0, deletedCount = 0;

    // --- 步驟 1: 新增或跳過事件 ---
    timeTreeEvents.forEach(ttEvent => {
      const title = ttEvent['任務標題'];
      const startTime = new Date(ttEvent['開始日期']);
      const timeStr = ttEvent['時間'];
      const colorHex = ttEvent['color'];
      
      const eventDateStr = startTime.toISOString().split('T')[0];
      const key = `${title}_${eventDateStr}`;
      
      if (googleEventMap.has(key)) {
        skippedCount++;
        googleEventMap.delete(key);
      } else {
        let newEvent;
        if (timeStr === '全天') {
          newEvent = calendar.createAllDayEvent(title, startTime);
        } else {
          const [hours, minutes] = timeStr.split(':').map(Number);
          startTime.setHours(hours, minutes, 0, 0);
          const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
          newEvent = calendar.createEvent(title, startTime, endTime);
        }
        addedCount++;
        const googleColor = getClosestGoogleColor(colorHex);
        if (newEvent && googleColor) newEvent.setColor(googleColor);
      }
    });

    // --- 步驟 2: 刪除多餘的事件 ---
    googleEventMap.forEach(eventToDelete => {
      eventToDelete.deleteEvent();
      deletedCount++;
    });

    return createJsonResponse({ status: 'success', message: `同步完成！新增: ${addedCount}, 刪除: ${deletedCount}, 跳過: ${skippedCount}.` });
  } catch (error) {
    Logger.log(error);
    return createJsonResponse({ status: 'error', message: '伺服器發生錯誤: ' + error.message });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
```

#### **步驟 1.3：設定你的日曆 ID**

1.  **找到日曆 ID**：
    *   打開 [Google 日曆](https://calendar.google.com/)。
    *   在左側「我的日曆」下方，找到你想同步的那個日曆，點擊旁邊的三個點，選擇「**設定和共用**」。
    *   向下滑動到「**整合日曆**」區塊，你會看到「**日曆 ID**」。它通常是你的 Gmail 地址或一長串以 `@group.calendar.google.com` 結尾的字串。
    *   **複製**這個 ID。
2.  **貼上 ID**：回到 Google Apps Script 編輯器，找到這一行 `const CALENDAR_ID = 'YOUR_CALENDAR_ID';`，將 `'YOUR_CALENDAR_ID'` 替換成你剛剛複製的 ID。

#### **步驟 1.4：部署為網路應用程式**

1.  **點擊部署**：點擊右上角的藍色「**部署**」按鈕，選擇「**新增部署作業**」。
2.  **設定部署類型**：
    *   點擊「選取類型」旁邊的齒輪圖示，選擇「**網頁應用程式**」。
    *   在「說明」欄位，輸入 `TimeTree Sync v3`。
    *   在「執行身分」欄位，選擇「**我 (你的信箱)**」。
    *   在「誰可以存取」欄位，選擇「**僅限我自己**」（這是最安全的選項）。
3.  **點擊「部署」**。
4.  **授權**：
    *   Google 會跳出一個視窗要求授權。點擊「**授權存取權**」。
    *   選擇你的 Google 帳號。
    *   可能會出現一個「Google 尚未驗證這個應用程式」的警告畫面。點擊「**進階**」，然後點擊下方的「**前往 (你的專案名稱) (不安全)**」。
    *   最後，點擊「**允許**」，授予腳本操作你日曆的權限。
5.  **複製 URL**：授權成功後，你會看到一個「**網頁應用程式網址**」。**複製這個完整的 URL**，下一步會用到。**這個 URL 非常重要，不要洩漏給他人**。

---

### **第二部分：設定油猴腳本 (前端工具)**

這是安裝在你瀏覽器上的工具，讓你在 TimeTree 網站上看到同步按鈕。

#### **步驟 2.1：安裝油猴 (Tampermonkey)**

如果你的瀏覽器還沒有這個擴充功能，請先安裝：
*   **Chrome**：[點此安裝](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
*   **Edge**：[點此安裝](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
*   **Firefox**：[點此安裝](https://addons.mozilla.org/firefox/addon/tampermonkey/)

#### **步驟 2.2：建立並貼上前端腳本**

1.  **建立新腳本**：點擊瀏覽器右上角的油猴圖示，選擇「**新增腳本...**」。
2.  **清空預設程式碼**：將編輯器中的所有內容刪除。
3.  **貼上新程式碼**：將下面**完整**的程式碼複製並貼到編輯器中。

```javascript
// ==UserScript==
// @name         TimeTree to Google Calendar Sync (v3 with Color)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Adds a button to TimeTree to fully sync (add/delete/color) events with a Google Calendar for the current month.
// @author       YourName
// @match        https://timetreeapp.com/calendars/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      script.google.com
// ==/UserScript==

(function() {
    'use strict';

    // --- 設定 ---
    // 將 'YOUR_APPS_SCRIPT_URL' 替換成你從 Google Apps Script 部署後複製的網址
    const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL';

    // --- 主要邏輯 ---
    function addSyncButton() {
        const targetContainer = document.querySelector('div.css-1bpni0w');
        if (!targetContainer) { setTimeout(addSyncButton, 1000); return; }

        const syncButton = document.createElement('button');
        syncButton.id = 'sync-to-gcal-button';
        syncButton.textContent = '完整同步至 Google 日曆';
        syncButton.addEventListener('click', handleSync);
        syncButton.title = '注意：此操作將新增、刪除、並更新顏色，使 Google 日曆與此頁面完全一致！';
        targetContainer.appendChild(syncButton);
    }

    function handleSync() {
        if (!confirm('此操作將會新增、刪除、並更新 Google 日曆上的事件顏色，使其與當前 TimeTree 月份完全同步。\n\n您確定要繼續嗎？')) return;

        const button = document.getElementById('sync-to-gcal-button');
        button.textContent = '分析中...';
        button.disabled = true;

        const syncData = scrapeCalendarData();
        if (syncData.events.length === 0 && !syncData.viewStartDate) {
            button.textContent = '找不到事件！';
            setTimeout(() => { button.textContent = '完整同步至 Google 日曆'; button.disabled = false; }, 3000);
            return;
        }

        button.textContent = `傳送 ${syncData.events.length} 個事件...`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: APPS_SCRIPT_URL,
            data: JSON.stringify(syncData),
            headers: { 'Content-Type': 'application/json' },
            onload: function(response) {
                try {
                    const result = JSON.parse(response.responseText);
                    button.textContent = result.status === 'success' ? `✅ ${result.message}` : `❌ 錯誤: ${result.message}`;
                } catch (e) { button.textContent = `❌ 回應解析錯誤`; }
                setTimeout(() => { button.textContent = '完整同步至 Google 日曆'; button.disabled = false; }, 10000);
            },
            onerror: function(error) {
                console.error('Sync Script Error:', error);
                button.textContent = '❌ 網路錯誤！';
                setTimeout(() => { button.textContent = '完整同步至 Google 日曆'; button.disabled = false; }, 5000);
            }
        });
    }

    function scrapeCalendarData() {
        const dateCells = document.querySelectorAll('div[role="gridcell"]');
        if (dateCells.length < 2) return { events: [] };
        
        const firstDateElement = dateCells[0].querySelector('.css-g51b5d, .css-q2isom');
        const lastDateElement = dateCells[dateCells.length - 1].querySelector('.css-g51b5d, .css-q2isom');
        const timeElement = document.querySelector('time.css-e1a69x');
        if (!timeElement || !firstDateElement || !lastDateElement) return { events: [] };
        
        const [monthName, yearStr] = timeElement.textContent.split(', ');
        const year = parseInt(yearStr, 10);
        const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].findIndex(m => m.toLowerCase() === monthName.toLowerCase());
        const firstDay = parseInt(firstDateElement.textContent, 10);
        const lastDay = parseInt(lastDateElement.textContent, 10);
        const startMonth = (firstDay > 20) ? month - 1 : month;
        const endMonth = (lastDay < 15) ? month + 1 : month;
        const viewStartDate = new Date(year, startMonth, firstDay);
        const viewEndDate = new Date(year, endMonth, lastDay);
        viewEndDate.setHours(23, 59, 59, 999);

        const dateMapByIndex = new Map();
        let currentMonthOffset = (firstDay > 20) ? -1 : 0;
        let lastDateNum = 0;
        dateCells.forEach((cell, index) => {
            const dateNumElement = cell.querySelector('.css-g51b5d, .css-q2isom');
            if (!dateNumElement) return;
            const dateNum = parseInt(dateNumElement.textContent, 10);
            if (index > 0 && dateNum < lastDateNum) currentMonthOffset++;
            const date = new Date(year, month + currentMonthOffset, dateNum);
            dateMapByIndex.set(index, date);
            lastDateNum = dateNum;
        });

        const eventElements = document.querySelectorAll('div.lndlxo5');
        const events = [];
        const colorRegex = /#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})/;

        eventElements.forEach(eventEl => {
            const style = getComputedStyle(eventEl);
            const eventDisplayRow = parseInt(style.getPropertyValue('--lndlxo3').trim(), 10);
            const startCol = parseInt(style.getPropertyValue('--lndlxo2').trim(), 10);
            const titleEl = eventEl.querySelector('span.lndlxo7');
            if (!titleEl || !eventDisplayRow || !startCol) return;

            const weekRowIndex = Math.floor((eventDisplayRow - 3) / 6);
            const dateCellIndex = (weekRowIndex * 7) + (startCol - 1);
            const startDate = dateMapByIndex.get(dateCellIndex);
            
            if (startDate) {
                const buttonEl = eventEl.querySelector('button');
                const styleAttr = buttonEl ? buttonEl.getAttribute('style') : '';
                const colorMatch = styleAttr.match(colorRegex);
                const color = colorMatch ? colorMatch[0] : null;

                const title = titleEl.textContent.trim();
                const timeEl = eventEl.querySelector('._1r1c5vl9, ._1bf4eeq8');
                const time = timeEl ? timeEl.textContent.trim() : '全天';
                
                events.push({ '任務標題': title, '開始日期': startDate.toISOString(), '時間': time, 'color': color });
            }
        });
        return { events, viewStartDate: viewStartDate.toISOString(), viewEndDate: viewEndDate.toISOString() };
    }

    GM_addStyle(`
        #sync-to-gcal-button { background-color: #D32F2F; color: white; border: none; padding: 0 16px; margin-left: 12px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold; height: 36px; line-height: 36px; transition: background-color 0.3s; }
        #sync-to-gcal-button:hover { background-color: #B71C1C; }
        #sync-to-gcal-button:disabled { background-color: #9E9E9E; cursor: not-allowed; }
    `);
    window.addEventListener('load', addSyncButton, false);
})();
```

#### **步驟 2.3：設定後端服務 URL**

1.  在油猴腳本編輯器中，找到這一行 `const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL';`。
2.  將 `'YOUR_APPS_SCRIPT_URL'` 替換成你在**步驟 1.4** 中複製的那個**網頁應用程式網址**。

#### **步驟 2.4：儲存腳本**

*   按下 `Ctrl + S` (Windows) 或 `Cmd + S` (Mac)，或者點擊編輯器上方的「檔案」->「儲存」。
*   確保在油猴的管理面板中，這個腳本是**啟用**狀態（開關是打開的）。

---

### **第三部分：如何使用**

現在，一切都準備就緒了！

1.  **前往 TimeTree 網站**：打開你的 TimeTree 日曆頁面，例如 `https://timetreeapp.com/calendars/你的日曆代碼`。
2.  **尋找同步按鈕**：頁面載入後，你應該會在頂部「Today」按鈕旁邊，看到一個新的紅色按鈕，上面寫著「**完整同步至 Google 日曆**」。
3.  **將滑鼠懸停在按鈕上**：你會看到一個提示，警告你此操作會修改你的 Google 日曆。
4.  **點擊按鈕**：點擊後，瀏覽器會彈出一個確認對話框，再次提醒你此操作的後果。
5.  **確認操作**：點擊對話框中的「**確定**」。
6.  **等待同步完成**：按鈕上的文字會顯示當前進度（分析中... -> 傳送中... -> 完成訊息）。
7.  **檢查結果**：同步完成後，打開你的 Google 日曆。你會發現：
    *   新的事件被加上了，並且顏色與 TimeTree 上的最接近。
    *   在 TimeTree 上被刪除的事件，也從你的 Google 日曆上消失了。
    *   你的 Google 日曆（在該月份的範圍內）現在看起來和 TimeTree 頁面一模一樣！

你可以隨時切換到 TimeTree 的不同月份，然後再次點擊同步按鈕，來同步該月份的內容。
