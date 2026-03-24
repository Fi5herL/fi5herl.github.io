/**
 * LINE Bot Migration — Google Apps Script MVP
 * ============================================
 * Architecture: webhook fast-path → event_queue → worker → Drive/AI
 *
 * ALL secrets/tokens are read from Script Properties (never hardcoded).
 * Script Properties required:
 *   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET,
 *   SPREADSHEET_ID, DRIVE_MEDIA_FOLDER_ID,
 *   FORCE_SYNC_AUTH_TOKEN
 * Optional:
 *   NOTIFY_USER_ID, AI_API_KEY, AI_API_ENDPOINT
 *
 * See LINE_BOT_README.md for full setup instructions.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Read all configuration. Secrets come from Script Properties only.
 * Non-sensitive tuning parameters are defined here as constants.
 */
function getConfig_() {
  const sp = PropertiesService.getScriptProperties();

  return {
    // ── Secrets (Script Properties) ──────────────────────────────────────────
    LINE_CHANNEL_ACCESS_TOKEN: sp.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '',
    LINE_CHANNEL_SECRET:       sp.getProperty('LINE_CHANNEL_SECRET')       || '',
    SPREADSHEET_ID:            sp.getProperty('SPREADSHEET_ID')            || '',
    DRIVE_MEDIA_FOLDER_ID:     sp.getProperty('DRIVE_MEDIA_FOLDER_ID')     || '',
    FORCE_SYNC_AUTH_TOKEN:     sp.getProperty('FORCE_SYNC_AUTH_TOKEN')     || '',
    NOTIFY_USER_ID:            sp.getProperty('NOTIFY_USER_ID')            || '',
    AI_API_KEY:                sp.getProperty('AI_API_KEY')                || '',
    AI_API_ENDPOINT:           sp.getProperty('AI_API_ENDPOINT')           || '',

    // ── Tuning (non-sensitive, safe to keep in code) ──────────────────────────
    WEBHOOK_MAX_MS:                1200,
    QUEUE_BATCH_SIZE:              50,
    QUEUE_MAX_RETRY:               5,
    QUEUE_RETRY_BACKOFF_SEC:       [30, 120, 300, 900, 1800],
    MEDIA_BATCH_SIZE:              10,
    MEDIA_MAX_FILE_MB:             25,
    MEDIA_FETCH_MAX_DELAY_MIN:     30,
    FORCE_SYNC_COOLDOWN_SEC:       60,
    FORCE_SYNC_MAX_RUNTIME_SEC:    50,
    FORCE_SYNC_EVENT_BATCH_MULT:   4,    // forceSync event batch = QUEUE_BATCH_SIZE * this
    FORCE_SYNC_MEDIA_BATCH_MULT:   3,    // forceSync media batch = MEDIA_BATCH_SIZE * this
    COMMAND_DEBOUNCE_SEC:          8,
    ONOPEN_DEBOUNCE_SEC:           60,
    SHEET_APPEND_BATCH_SIZE:       100,
    SHEET_WRITE_DEDUP_WINDOW_SEC:  120,
    DEDUP_SCAN_MAX_ROWS:           500,
    WORKER_MAX_RUNTIME_MS:         25000, // event/media worker soft time limit
    MEDIA_WORKER_MAX_RUNTIME_MS:   50000, // media worker soft time limit
    LOCK_TIMEOUT_MS:               3000,  // tryLock timeout for workers
    FORCE_SYNC_LOCK_TIMEOUT_MS:    5000,  // tryLock timeout for forceSync
    AI_SUMMARY_INTERVAL_MIN:       10,
    AI_COOLDOWN_PER_GROUP_MIN:     20,
    USER_RATE_LIMIT_PER_MIN:       20,
    GROUP_RATE_LIMIT_PER_MIN:      120,

    // ── Sheet tab names ───────────────────────────────────────────────────────
    TAB_EVENT_QUEUE:   'event_queue',
    TAB_MEDIA_QUEUE:   'media_queue',
    TAB_SYNC_LOG:      'sync_log',
    TAB_DEAD_LETTER:   'dead_letter',
    TAB_SYSTEM_QUEUE:  '_system_queue',
  };
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const Log = {
  info:  function(msg) { Logger.log('[INFO]  ' + msg); },
  warn:  function(msg) { Logger.log('[WARN]  ' + msg); },
  error: function(msg) { Logger.log('[ERROR] ' + msg); },
};

// ─── Sheet Helpers ────────────────────────────────────────────────────────────

/**
 * Get or create a sheet tab by name in the configured Spreadsheet.
 * @param {string} tabName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateTab_(tabName) {
  const cfg = getConfig_();
  if (!cfg.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID not set in Script Properties.');
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  return ss.getSheetByName(tabName) || ss.insertSheet(tabName);
}

/**
 * Append rows to a sheet (batched).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<Array>} rows - array of row arrays
 */
function appendRows_(sheet, rows) {
  if (!rows || rows.length === 0) return;
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Generate a simple unique ID.
 * @returns {string}
 */
function uid_() {
  return Utilities.getUuid();
}

// ─── Queue Helpers ────────────────────────────────────────────────────────────

/** Column indices (1-based) for event_queue */
const EQ_COL = {
  id: 1, event_id: 2, message_id: 3, received_at: 4,
  event_type: 5, message_type: 6, source_type: 7, source_id: 8,
  user_id: 9, text: 10, status: 11, retry_count: 12,
  last_error: 13, processed_at: 14,
};
const EQ_HEADERS = [
  'id','event_id','message_id','received_at','event_type','message_type',
  'source_type','source_id','user_id','text','status','retry_count',
  'last_error','processed_at',
];

/** Column indices (1-based) for media_queue */
const MQ_COL = {
  id: 1, event_id: 2, message_id: 3, media_type: 4, source_id: 5,
  received_at: 6, status: 7, retry_count: 8, drive_file_id: 9,
  drive_url: 10, file_size_bytes: 11, last_error: 12, processed_at: 13,
};
const MQ_HEADERS = [
  'id','event_id','message_id','media_type','source_id','received_at',
  'status','retry_count','drive_file_id','drive_url','file_size_bytes',
  'last_error','processed_at',
];

/**
 * Ensure headers exist on a sheet (writes row 1 if empty).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
}

/**
 * Enqueue a single LINE event into event_queue.
 * @param {Object} event - raw LINE event object
 */
function enqueueEvent_(event) {
  const cfg = getConfig_();
  const sheet = getOrCreateTab_(cfg.TAB_EVENT_QUEUE);
  ensureHeaders_(sheet, EQ_HEADERS);

  const msgId   = (event.message && event.message.id) ? event.message.id : '';
  const msgType = (event.message && event.message.type) ? event.message.type : '';
  const text    = (event.message && event.message.text) ? event.message.text : '';
  const src     = event.source || {};
  const srcType = src.type || '';
  const srcId   = src.groupId || src.roomId || src.userId || '';
  const userId  = src.userId || '';

  // Dedup check: skip if same message_id seen in last SHEET_WRITE_DEDUP_WINDOW_SEC
  if (msgId && isDuplicate_(sheet, EQ_COL.message_id, msgId, cfg.SHEET_WRITE_DEDUP_WINDOW_SEC)) {
    Log.warn('enqueueEvent_: duplicate message_id=' + msgId + ', skipped.');
    return;
  }

  const row = [
    uid_(),
    event.webhookEventId || event.replyToken || uid_(),
    msgId,
    new Date(),
    event.type || '',
    msgType,
    srcType,
    srcId,
    userId,
    text,
    'pending',
    0,
    '',
    '',
  ];
  appendRows_(sheet, [row]);
}

/**
 * Enqueue a media item into media_queue.
 * Called from processEventQueue_ when media event is encountered.
 */
function enqueueMedia_(eventRow) {
  const cfg = getConfig_();
  const sheet = getOrCreateTab_(cfg.TAB_MEDIA_QUEUE);
  ensureHeaders_(sheet, MQ_HEADERS);

  const row = [
    uid_(),
    eventRow[EQ_COL.event_id - 1],
    eventRow[EQ_COL.message_id - 1],
    eventRow[EQ_COL.message_type - 1],
    eventRow[EQ_COL.source_id - 1],
    new Date(),
    'pending',
    0,
    '', '', 0, '', '',
  ];
  appendRows_(sheet, [row]);
}

/**
 * Check if a value exists in a sheet column within a time window.
 * Assumes col 4 (received_at / 6th for media) holds the timestamp.
 * For simplicity, scans last DEDUP_SCAN_MAX_ROWS rows.
 */
function isDuplicate_(sheet, colIndex, value, windowSec) {
  const cfg     = getConfig_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const scanRows = Math.min(lastRow - 1, cfg.DEDUP_SCAN_MAX_ROWS);
  const startRow = Math.max(2, lastRow - scanRows + 1);
  const range = sheet.getRange(startRow, colIndex, scanRows, 1).getValues();
  const cutoff = Date.now() - windowSec * 1000;
  // We also need timestamps — read col 4 (received_at)
  const tsRange = sheet.getRange(startRow, 4, scanRows, 1).getValues();
  for (let i = 0; i < range.length; i++) {
    if (String(range[i][0]) === String(value)) {
      const ts = tsRange[i][0] ? new Date(tsRange[i][0]).getTime() : 0;
      if (ts > cutoff) return true;
    }
  }
  return false;
}

// ─── doPost — Webhook Entry (Fast ACK) ────────────────────────────────────────

/**
 * LINE webhook endpoint.
 * Must respond within ~1 second to avoid LINE retrying the request.
 * Heavy processing is deferred to worker functions.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  const start = Date.now();
  try {
    const cfg = getConfig_();

    if (!e || !e.postData || !e.postData.contents) {
      Log.warn('doPost: empty request body');
      return jsonResponse_({ ok: false, error: 'empty body' }, 400);
    }

    const rawBody = e.postData.contents;

    // ── Signature verification ─────────────────────────────────────────────
    if (cfg.LINE_CHANNEL_SECRET) {
      const signature = (e.parameter && e.parameter['x-line-signature'])
        || (e.postData.headers && e.postData.headers['X-Line-Signature'])
        || '';
      // GAS doesn't expose request headers in all deploy modes;
      // the header arrives as a query parameter in some LINE relay setups.
      // When LINE_CHANNEL_SECRET is set, an absent or invalid signature is rejected.
      if (!signature || !verifyLineSignature_(rawBody, cfg.LINE_CHANNEL_SECRET, signature)) {
        Log.warn('doPost: invalid or missing LINE signature');
        return jsonResponse_({ ok: false, error: 'invalid signature' }, 403);
      }
    }

    // ── Parse payload ──────────────────────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseErr) {
      Log.error('doPost: JSON parse error: ' + parseErr.message);
      return jsonResponse_({ ok: false, error: 'bad json' }, 400);
    }

    const events = (payload && payload.events) ? payload.events : [];

    // ── Enqueue each event — fast, no heavy processing ─────────────────────
    for (const ev of events) {
      try {
        enqueueEvent_(ev);
      } catch (enqErr) {
        Log.error('doPost: enqueue error for event ' + (ev.type || '?') + ': ' + enqErr.message);
        // Continue processing other events; don't fail the whole webhook
      }
    }

    const elapsed = Date.now() - start;
    Log.info('doPost: queued ' + events.length + ' event(s) in ' + elapsed + 'ms');

    // ── Fast ACK ───────────────────────────────────────────────────────────
    return jsonResponse_({ ok: true, queued: events.length });

  } catch (err) {
    Log.error('doPost: unexpected error: ' + err.message);
    // Always return 200 to LINE to prevent retry storms
    return jsonResponse_({ ok: true, note: 'internal error logged' });
  }
}

// ─── doGet — Manual Endpoints ─────────────────────────────────────────────────

/**
 * GET endpoint for manual operations.
 * Supported actions:
 *   ?action=forceSync&token=<FORCE_SYNC_AUTH_TOKEN>
 *   ?action=status&token=<FORCE_SYNC_AUTH_TOKEN>
 *
 * @param {GoogleAppsScript.Events.DoGet} e
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  const token  = (e && e.parameter && e.parameter.token)  || '';
  const cfg    = getConfig_();

  // ── Auth ─────────────────────────────────────────────────────────────────
  if (!cfg.FORCE_SYNC_AUTH_TOKEN || token !== cfg.FORCE_SYNC_AUTH_TOKEN) {
    return jsonResponse_({ ok: false, error: 'unauthorized' }, 403);
  }

  if (action === 'forceSync') {
    return forceSync_();
  }

  if (action === 'status') {
    return getStatus_();
  }

  return jsonResponse_({
    ok: true,
    message: 'LINE Bot GAS — available actions: forceSync, status',
  });
}

// ─── Force Sync ───────────────────────────────────────────────────────────────

/**
 * Flush all queues immediately. Acquires ScriptLock to avoid conflicts.
 * Enforces a cooldown to prevent abuse.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function forceSync_() {
  const cfg  = getConfig_();
  const sp   = PropertiesService.getScriptProperties();
  const start = Date.now();

  // ── Cooldown check ────────────────────────────────────────────────────────
  const lastSync = Number(sp.getProperty('_last_force_sync_ts') || 0);
  if (Date.now() - lastSync < cfg.FORCE_SYNC_COOLDOWN_SEC * 1000) {
    const remaining = Math.ceil((cfg.FORCE_SYNC_COOLDOWN_SEC * 1000 - (Date.now() - lastSync)) / 1000);
    return jsonResponse_({ ok: false, error: 'cooldown', retry_after_sec: remaining });
  }

  // ── Lock ──────────────────────────────────────────────────────────────────
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(cfg.FORCE_SYNC_LOCK_TIMEOUT_MS)) {
    return jsonResponse_({ ok: false, error: 'busy — another sync is running' });
  }

  try {
    sp.setProperty('_last_force_sync_ts', String(Date.now()));

    const maxRunMs = cfg.FORCE_SYNC_MAX_RUNTIME_SEC * 1000;

    const r1 = flushEventQueue_(
      Math.min(cfg.QUEUE_BATCH_SIZE * cfg.FORCE_SYNC_EVENT_BATCH_MULT, cfg.QUEUE_BATCH_SIZE * 4),
      maxRunMs - (Date.now() - start)
    );
    const r2 = flushMediaQueue_(
      Math.min(cfg.MEDIA_BATCH_SIZE * cfg.FORCE_SYNC_MEDIA_BATCH_MULT, cfg.MEDIA_BATCH_SIZE * 3)
    );

    const summary = {
      ok: true,
      trigger: 'forceSync',
      synced_events:     r1.done,
      failed_events:     r1.fail,
      remaining_events:  r1.remaining,
      synced_media:      r2.done,
      failed_media:      r2.fail,
      remaining_media:   r2.remaining,
      duration_ms:       Date.now() - start,
    };

    writeToSyncLog_('forceSync', r1.done + r2.done, r1.fail + r2.fail, Date.now() - start, '');

    Log.info('forceSync done: ' + JSON.stringify(summary));
    return jsonResponse_(summary);

  } finally {
    lock.releaseLock();
  }
}

// ─── Event Queue Worker ───────────────────────────────────────────────────────

/**
 * Process pending events from event_queue.
 * Called by time-driven trigger (every 30 seconds) or manually.
 *
 * @param {number} [batchSize] - override batch size
 * @param {number} [maxRunMs]  - stop after this many ms
 */
function processEventQueue(batchSize, maxRunMs) {
  const cfg   = getConfig_();
  const start = Date.now();
  batchSize   = batchSize || cfg.QUEUE_BATCH_SIZE;
  maxRunMs    = maxRunMs  || cfg.WORKER_MAX_RUNTIME_MS;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(cfg.LOCK_TIMEOUT_MS)) {
    Log.warn('processEventQueue: could not acquire lock, skipping');
    return { done: 0, fail: 0, remaining: -1 };
  }

  let done = 0, fail = 0;

  try {
    const sheet = getOrCreateTab_(cfg.TAB_EVENT_QUEUE);
    ensureHeaders_(sheet, EQ_HEADERS);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { done: 0, fail: 0, remaining: 0 };

    const dataRange = sheet.getRange(2, 1, lastRow - 1, EQ_HEADERS.length);
    const rows      = dataRange.getValues();

    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      if (Date.now() - start > maxRunMs) {
        Log.warn('processEventQueue: approaching time limit, stopping early');
        break;
      }
      if (processed >= batchSize) break;

      const row    = rows[i];
      const status = row[EQ_COL.status - 1];
      const retry  = Number(row[EQ_COL.retry_count - 1]) || 0;

      if (status !== 'pending') continue;

      // Check retry backoff
      if (retry > 0) {
        const receivedAt    = new Date(row[EQ_COL.received_at - 1]).getTime();
        const backoffMs     = (cfg.QUEUE_RETRY_BACKOFF_SEC[retry - 1] || 1800) * 1000;
        const lastErrorTime = row[EQ_COL.processed_at - 1]
          ? new Date(row[EQ_COL.processed_at - 1]).getTime()
          : receivedAt;
        if (Date.now() - lastErrorTime < backoffMs) continue;
      }

      const rowNum = i + 2; // sheet row (1-based, +1 for header)

      try {
        // Mark as processing
        sheet.getRange(rowNum, EQ_COL.status, 1, 1).setValue('processing');

        const eventType   = row[EQ_COL.event_type - 1];
        const messageType = row[EQ_COL.message_type - 1];

        if (eventType === 'message') {
          if (['image', 'file', 'video', 'audio'].includes(messageType)) {
            // Route to media queue
            enqueueMedia_(row);
            Log.info('processEventQueue: routed media event row=' + rowNum);
          } else if (messageType === 'text') {
            handleTextEvent_(row, cfg);
          } else {
            Log.info('processEventQueue: skipping message_type=' + messageType);
          }
        } else {
          Log.info('processEventQueue: non-message event type=' + eventType);
        }

        // Mark done
        sheet.getRange(rowNum, EQ_COL.status,       1, 1).setValue('done');
        sheet.getRange(rowNum, EQ_COL.processed_at, 1, 1).setValue(new Date());
        done++;

      } catch (err) {
        fail++;
        const newRetry = retry + 1;
        if (newRetry >= cfg.QUEUE_MAX_RETRY) {
          sheet.getRange(rowNum, EQ_COL.status, 1, 1).setValue('dead_letter');
          moveToDeadLetter_(row, err.message);
        } else {
          sheet.getRange(rowNum, EQ_COL.status,       1, 1).setValue('pending');
          sheet.getRange(rowNum, EQ_COL.retry_count,  1, 1).setValue(newRetry);
          sheet.getRange(rowNum, EQ_COL.last_error,   1, 1).setValue(err.message);
          sheet.getRange(rowNum, EQ_COL.processed_at, 1, 1).setValue(new Date());
        }
        Log.error('processEventQueue: row=' + rowNum + ' err=' + err.message);
      }

      processed++;
    }

    // Count remaining pending
    const remaining = rows.filter(r => r[EQ_COL.status - 1] === 'pending').length - done;

    Log.info('processEventQueue: done=' + done + ' fail=' + fail + ' remaining≈' + Math.max(0, remaining));
    return { done, fail, remaining: Math.max(0, remaining) };

  } finally {
    lock.releaseLock();
  }
}

// ─── Media Queue Worker ───────────────────────────────────────────────────────

/**
 * Process pending media items from media_queue.
 * Downloads from LINE API, uploads to Google Drive.
 * Called by time-driven trigger (every 60 seconds) or manually.
 *
 * @param {number} [batchSize]
 * @returns {{done: number, fail: number, remaining: number}}
 */
function processMediaQueue(batchSize) {
  const cfg   = getConfig_();
  const start = Date.now();
  batchSize   = batchSize || cfg.MEDIA_BATCH_SIZE;

  if (!cfg.LINE_CHANNEL_ACCESS_TOKEN) {
    Log.warn('processMediaQueue: LINE_CHANNEL_ACCESS_TOKEN not configured, skipping');
    return { done: 0, fail: 0, remaining: 0 };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(cfg.LOCK_TIMEOUT_MS)) {
    Log.warn('processMediaQueue: could not acquire lock, skipping');
    return { done: 0, fail: 0, remaining: -1 };
  }

  let done = 0, fail = 0;

  try {
    const sheet = getOrCreateTab_(cfg.TAB_MEDIA_QUEUE);
    ensureHeaders_(sheet, MQ_HEADERS);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { done: 0, fail: 0, remaining: 0 };

    const dataRange = sheet.getRange(2, 1, lastRow - 1, MQ_HEADERS.length);
    const rows      = dataRange.getValues();

    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      if (processed >= batchSize) break;
      if (Date.now() - start > cfg.MEDIA_WORKER_MAX_RUNTIME_MS) {
        Log.warn('processMediaQueue: approaching time limit, stopping early');
        break;
      }

      const row    = rows[i];
      const status = row[MQ_COL.status - 1];
      const retry  = Number(row[MQ_COL.retry_count - 1]) || 0;

      if (status !== 'pending') continue;

      // Check if media is too old (LINE content expiry)
      const receivedAt  = new Date(row[MQ_COL.received_at - 1]).getTime();
      const maxDelayMs  = cfg.MEDIA_FETCH_MAX_DELAY_MIN * 60 * 1000;
      if (Date.now() - receivedAt > maxDelayMs) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, MQ_COL.status,     1, 1).setValue('expired');
        sheet.getRange(rowNum, MQ_COL.last_error, 1, 1).setValue('LINE content expired');
        Log.warn('processMediaQueue: message_id=' + row[MQ_COL.message_id - 1] + ' expired');
        fail++;
        processed++;
        continue;
      }

      const rowNum = i + 2;

      try {
        sheet.getRange(rowNum, MQ_COL.status, 1, 1).setValue('downloading');

        const messageId = row[MQ_COL.message_id - 1];
        const mediaType = row[MQ_COL.media_type  - 1];

        const { driveFileId, driveUrl, fileSizeBytes } =
          downloadLineMediaToDrive_(messageId, mediaType, cfg);

        sheet.getRange(rowNum, MQ_COL.status,          1, 1).setValue('done');
        sheet.getRange(rowNum, MQ_COL.drive_file_id,   1, 1).setValue(driveFileId);
        sheet.getRange(rowNum, MQ_COL.drive_url,       1, 1).setValue(driveUrl);
        sheet.getRange(rowNum, MQ_COL.file_size_bytes, 1, 1).setValue(fileSizeBytes);
        sheet.getRange(rowNum, MQ_COL.processed_at,    1, 1).setValue(new Date());

        done++;
        Log.info('processMediaQueue: done message_id=' + messageId);

      } catch (err) {
        fail++;
        const newRetry = retry + 1;
        if (newRetry >= cfg.QUEUE_MAX_RETRY) {
          sheet.getRange(rowNum, MQ_COL.status, 1, 1).setValue('dead_letter');
        } else {
          sheet.getRange(rowNum, MQ_COL.status,       1, 1).setValue('pending');
          sheet.getRange(rowNum, MQ_COL.retry_count,  1, 1).setValue(newRetry);
          sheet.getRange(rowNum, MQ_COL.last_error,   1, 1).setValue(err.message);
          sheet.getRange(rowNum, MQ_COL.processed_at, 1, 1).setValue(new Date());
        }
        Log.error('processMediaQueue: row=' + rowNum + ' err=' + err.message);
      }

      processed++;
    }

    const remaining = rows.filter(r => r[MQ_COL.status - 1] === 'pending').length - done;

    Log.info('processMediaQueue: done=' + done + ' fail=' + fail + ' remaining≈' + Math.max(0, remaining));
    return { done, fail, remaining: Math.max(0, remaining) };

  } finally {
    lock.releaseLock();
  }
}

// ─── Worker: flush wrappers (used by forceSync) ───────────────────────────────

function flushEventQueue_(batchSize, maxRunMs) {
  const cfg = getConfig_();
  return processEventQueue(batchSize, maxRunMs || cfg.WORKER_MAX_RUNTIME_MS);
}

function flushMediaQueue_(batchSize) {
  return processMediaQueue(batchSize);
}

// ─── LINE API Helpers ─────────────────────────────────────────────────────────

/**
 * Download a LINE media message and upload to Google Drive.
 * @param {string} messageId
 * @param {string} mediaType - image / file / video / audio
 * @param {Object} cfg
 * @returns {{driveFileId: string, driveUrl: string, fileSizeBytes: number}}
 */
function downloadLineMediaToDrive_(messageId, mediaType, cfg) {
  const url = 'https://api-data.line.me/v2/bot/message/' + messageId + '/content';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + cfg.LINE_CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('LINE media API ' + response.getResponseCode() + ': ' + response.getContentText());
  }

  const blob        = response.getBlob();
  const contentType = blob.getContentType() || 'application/octet-stream';
  const ext         = mimeToExt_(contentType);
  const filename    = mediaType + '-' + messageId + '.' + ext;
  blob.setName(filename);

  const fileSizeBytes = blob.getBytes().length;
  if (fileSizeBytes > cfg.MEDIA_MAX_FILE_MB * 1024 * 1024) {
    throw new Error('File too large (' + Math.round(fileSizeBytes / 1048576) + 'MB > ' + cfg.MEDIA_MAX_FILE_MB + 'MB limit)');
  }

  let folder;
  if (cfg.DRIVE_MEDIA_FOLDER_ID) {
    folder = DriveApp.getFolderById(cfg.DRIVE_MEDIA_FOLDER_ID);
  } else {
    folder = DriveApp.getRootFolder();
    Log.warn('downloadLineMediaToDrive_: DRIVE_MEDIA_FOLDER_ID not set, using root folder');
  }

  const file     = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    driveFileId:  file.getId(),
    driveUrl:     file.getUrl(),
    fileSizeBytes: fileSizeBytes,
  };
}

/**
 * Send a LINE reply message.
 * @param {string} replyToken
 * @param {string} text
 * @param {string} channelAccessToken
 */
function lineReply_(replyToken, text, channelAccessToken) {
  if (!replyToken || !channelAccessToken) {
    Log.warn('lineReply_: missing replyToken or token');
    return;
  }
  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
  };
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + channelAccessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('LINE reply API ' + response.getResponseCode() + ': ' + response.getContentText());
  }
}

/**
 * Verify LINE webhook signature.
 * @param {string} rawBody
 * @param {string} secret
 * @param {string} signature - base64
 * @returns {boolean}
 */
function verifyLineSignature_(rawBody, secret, signature) {
  try {
    const mac      = Utilities.computeHmacSha256Signature(rawBody, secret);
    const expected = Utilities.base64Encode(mac);
    return expected === signature;
  } catch (e) {
    Log.error('verifyLineSignature_: ' + e.message);
    return false;
  }
}

// ─── Text Event Handler ───────────────────────────────────────────────────────

/**
 * Handle a text message event.
 * Command-type messages (/a /d /help /sync) get a quick reply.
 * All messages are appended to the log sheet.
 *
 * @param {Array} eventRow - row from event_queue
 * @param {Object} cfg
 */
function handleTextEvent_(eventRow, cfg) {
  const text       = String(eventRow[EQ_COL.text      - 1] || '').trim();
  const replyToken = eventRow[EQ_COL.event_id - 1]; // replyToken is stored in event_id column
  const userId     = eventRow[EQ_COL.user_id  - 1];

  // ── Command routing ───────────────────────────────────────────────────────
  if (text.startsWith('/')) {
    const cmd = text.split(/\s+/)[0].toLowerCase();

    // Debounce: skip if same user sent same command within COMMAND_DEBOUNCE_SEC
    const debounceKey = '_debounce_' + userId + '_' + cmd;
    const lastTs = Number(PropertiesService.getScriptProperties().getProperty(debounceKey) || 0);
    if (Date.now() - lastTs < cfg.COMMAND_DEBOUNCE_SEC * 1000) {
      Log.info('handleTextEvent_: debounced cmd=' + cmd + ' userId=' + userId);
      return;
    }
    PropertiesService.getScriptProperties().setProperty(debounceKey, String(Date.now()));

    if (cmd === '/help') {
      lineReply_(replyToken, '可用指令：/help /status /sync', cfg.LINE_CHANNEL_ACCESS_TOKEN);

    } else if (cmd === '/status') {
      const statusMsg = getStatusText_();
      lineReply_(replyToken, statusMsg, cfg.LINE_CHANNEL_ACCESS_TOKEN);

    } else if (cmd === '/sync') {
      // Enqueue a force-sync task rather than running it inline
      enqueueSyncTask_('line_command');
      lineReply_(replyToken, '同步任務已排程，稍後執行。', cfg.LINE_CHANNEL_ACCESS_TOKEN);

    } else {
      // Unknown command — placeholder for /a /d etc.
      Log.info('handleTextEvent_: unrecognised command=' + cmd);
      // TODO: add /a and /d lookup logic here (Phase 4)
    }
  }

  // ── Log all text events (MVP: just log, no further processing) ────────────
  Log.info('handleTextEvent_: userId=' + userId + ' text=' + text.slice(0, 80));
}

// ─── onOpen Trigger ───────────────────────────────────────────────────────────

/**
 * Triggered when the bound Google Spreadsheet is opened.
 * Only enqueues a lightweight sync task — does NOT run heavy work directly.
 * Install as a trigger: Edit > Current project's triggers > onOpen (From spreadsheet > On open)
 */
function onOpen() {
  try {
    const cfg  = getConfig_();
    const p    = PropertiesService.getDocumentProperties();
    const last = Number(p.getProperty('_last_open_sync_ts') || 0);
    const now  = Date.now();

    // Debounce: one enqueue per ONOPEN_DEBOUNCE_SEC
    if (now - last < cfg.ONOPEN_DEBOUNCE_SEC * 1000) {
      Log.info('onOpen: debounced (last=' + new Date(last).toISOString() + ')');
      return;
    }

    p.setProperty('_last_open_sync_ts', String(now));
    enqueueSyncTask_('onOpen');
    Log.info('onOpen: sync task enqueued');
  } catch (e) {
    Log.error('onOpen: ' + e.message);
  }
}

/**
 * Write a sync-request record to _system_queue so workers can pick it up.
 * @param {string} source - trigger source label
 */
function enqueueSyncTask_(source) {
  const cfg   = getConfig_();
  const sheet = getOrCreateTab_(cfg.TAB_SYSTEM_QUEUE);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'task', 'source', 'status']);
  }
  sheet.appendRow([new Date(), 'force_sync', source, 'pending']);
}

// ─── Sync Log ─────────────────────────────────────────────────────────────────

/**
 * Append a summary row to sync_log.
 */
function writeToSyncLog_(trigger, eventsProcessed, failedCount, durationMs, notes) {
  try {
    const cfg   = getConfig_();
    const sheet = getOrCreateTab_(cfg.TAB_SYNC_LOG);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['timestamp','trigger','events_processed','media_processed','failed_count','duration_ms','notes']);
    }
    sheet.appendRow([new Date(), trigger, eventsProcessed, 0, failedCount, durationMs, notes || '']);
  } catch (e) {
    Log.error('writeToSyncLog_: ' + e.message);
  }
}

// ─── Dead Letter ──────────────────────────────────────────────────────────────

/**
 * Move a failed event row to the dead_letter sheet.
 * @param {Array} row
 * @param {string} errorMsg
 */
function moveToDeadLetter_(row, errorMsg) {
  try {
    const cfg   = getConfig_();
    const sheet = getOrCreateTab_(cfg.TAB_DEAD_LETTER);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([...EQ_HEADERS, 'dead_at', 'final_error']);
    }
    sheet.appendRow([...row, new Date(), errorMsg]);
  } catch (e) {
    Log.error('moveToDeadLetter_: ' + e.message);
  }
}

// ─── Status Helpers ───────────────────────────────────────────────────────────

/**
 * Return a JSON status response for doGet?action=status.
 */
function getStatus_() {
  const cfg  = getConfig_();
  const info = {};

  try {
    const eqSheet = getOrCreateTab_(cfg.TAB_EVENT_QUEUE);
    const mqSheet = getOrCreateTab_(cfg.TAB_MEDIA_QUEUE);

    info.event_queue_rows  = Math.max(0, eqSheet.getLastRow() - 1);
    info.media_queue_rows  = Math.max(0, mqSheet.getLastRow() - 1);
    info.spreadsheet_id    = cfg.SPREADSHEET_ID ? '(set)' : '(not set)';
    info.line_token_set    = !!cfg.LINE_CHANNEL_ACCESS_TOKEN;
    info.media_folder_set  = !!cfg.DRIVE_MEDIA_FOLDER_ID;
  } catch (e) {
    info.error = e.message;
  }

  return jsonResponse_({ ok: true, status: info });
}

/**
 * Return a short status text for LINE reply.
 */
function getStatusText_() {
  const cfg = getConfig_();
  try {
    const eqSheet = getOrCreateTab_(cfg.TAB_EVENT_QUEUE);
    const mqSheet = getOrCreateTab_(cfg.TAB_MEDIA_QUEUE);
    const pending = countByStatus_(eqSheet, EQ_COL.status - 1, 'pending');
    const mediaPending = countByStatus_(mqSheet, MQ_COL.status - 1, 'pending');
    return '事件隊列 pending: ' + pending + '\n媒體隊列 pending: ' + mediaPending;
  } catch (e) {
    return '無法讀取狀態: ' + e.message;
  }
}

/**
 * Count rows with a specific status value.
 */
function countByStatus_(sheet, colIndex, statusValue) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  return values.filter(r => r[0] === statusValue).length;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Create a JSON ContentService response.
 * @param {Object} obj
 * @param {number} [_status] - ignored (GAS doesn't support HTTP status codes in doGet/doPost)
 */
function jsonResponse_(obj, _status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Map MIME type to a file extension.
 */
function mimeToExt_(mimeType) {
  const map = {
    'image/jpeg':      'jpg',
    'image/png':       'png',
    'image/gif':       'gif',
    'image/webp':      'webp',
    'video/mp4':       'mp4',
    'audio/m4a':       'm4a',
    'audio/mpeg':      'mp3',
    'application/pdf': 'pdf',
  };
  return map[mimeType] || 'bin';
}

// ─── Trigger Setup ────────────────────────────────────────────────────────────

/**
 * Set up time-driven triggers for the workers.
 * Run this once from the GAS editor after initial setup.
 */
function setupTriggers() {
  // Remove old worker triggers first
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction();
    if (fn === 'processEventQueue' || fn === 'processMediaQueue') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Event queue: every minute (minimum GAS allows is 1 min, use 1 min for MVP)
  ScriptApp.newTrigger('processEventQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  // Media queue: every minute
  ScriptApp.newTrigger('processMediaQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  Log.info('setupTriggers: event and media worker triggers created.');
}

/**
 * Remove all triggers created by this script (for cleanup).
 */
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Log.info('removeAllTriggers: all triggers removed.');
}

// ─── Tests (run manually in GAS editor) ──────────────────────────────────────

/**
 * Verify all required Script Properties are set.
 * Run in GAS editor to confirm setup is correct.
 */
function testConfig() {
  const cfg = getConfig_();
  const required = [
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_SECRET',
    'SPREADSHEET_ID',
    'DRIVE_MEDIA_FOLDER_ID',
    'FORCE_SYNC_AUTH_TOKEN',
  ];
  let allOk = true;
  required.forEach(function(key) {
    if (!cfg[key]) {
      Log.error('testConfig: MISSING Script Property: ' + key);
      allOk = false;
    } else {
      Log.info('testConfig: OK ' + key);
    }
  });
  Log.info(allOk ? 'testConfig: ALL REQUIRED PROPERTIES SET ✓' : 'testConfig: SOME PROPERTIES MISSING ✗');
  return allOk;
}

/**
 * Enqueue a fake text event for testing.
 * Check the event_queue sheet after running this.
 */
function testEnqueueEvent() {
  const fakeEvent = {
    webhookEventId: 'test-' + Date.now(),
    replyToken:     'test-reply-token',
    type:           'message',
    source:         { type: 'user', userId: 'Utest123' },
    message:        { id: 'msg-' + Date.now(), type: 'text', text: '/help test message' },
  };
  enqueueEvent_(fakeEvent);
  Log.info('testEnqueueEvent: fake event enqueued. Check event_queue sheet.');
}

/**
 * Enqueue a fake image event for testing media pipeline.
 */
function testEnqueueMediaEvent() {
  const fakeEvent = {
    webhookEventId: 'test-media-' + Date.now(),
    replyToken:     'test-reply-token',
    type:           'message',
    source:         { type: 'group', groupId: 'Ctest456', userId: 'Utest123' },
    message:        { id: 'imgmsg-' + Date.now(), type: 'image' },
  };
  enqueueEvent_(fakeEvent);
  Log.info('testEnqueueMediaEvent: fake image event enqueued. Check event_queue sheet, then run processEventQueue().');
}

/**
 * Run processEventQueue manually and log results.
 */
function testProcessEventQueue() {
  const result = processEventQueue(10, 20000);
  Log.info('testProcessEventQueue: ' + JSON.stringify(result));
}

/**
 * Run processMediaQueue manually and log results.
 */
function testProcessMediaQueue() {
  const result = processMediaQueue(5);
  Log.info('testProcessMediaQueue: ' + JSON.stringify(result));
}

/**
 * Test forceSync_ directly (bypasses auth token check).
 * Note: FORCE_SYNC_AUTH_TOKEN must be set in Script Properties.
 */
function testForceSync() {
  const cfg = getConfig_();
  if (!cfg.FORCE_SYNC_AUTH_TOKEN) {
    Log.error('testForceSync: FORCE_SYNC_AUTH_TOKEN not set — aborting.');
    return;
  }
  // Reset cooldown for testing
  PropertiesService.getScriptProperties().deleteProperty('_last_force_sync_ts');
  const output = forceSync_();
  Log.info('testForceSync response: ' + output.getContent());
}

/**
 * Test onOpen handler manually.
 * Check _system_queue sheet for a new entry.
 */
function testOnOpen() {
  // Reset debounce for testing
  PropertiesService.getDocumentProperties().deleteProperty('_last_open_sync_ts');
  onOpen();
  Log.info('testOnOpen: check _system_queue sheet for new force_sync entry.');
}

/**
 * Test LINE signature verification with a known body+secret.
 */
function testLineSignature() {
  const body   = '{"test":"payload"}';
  const secret = 'test_secret';
  const mac    = Utilities.computeHmacSha256Signature(body, secret);
  const sig    = Utilities.base64Encode(mac);
  const result = verifyLineSignature_(body, secret, sig);
  Log.info('testLineSignature: ' + (result ? 'PASS ✓' : 'FAIL ✗'));
  const badResult = verifyLineSignature_(body, secret, 'badsig==');
  Log.info('testLineSignature (bad sig): ' + (!badResult ? 'PASS ✓' : 'FAIL ✗'));
}
