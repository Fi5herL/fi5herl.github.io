/**
 * Fi5her Blog — Google Docs → GitHub Publisher
 * =============================================
 * Deploy this script as a Google Apps Script project.
 *
 * Setup:
 *  1. Open script.google.com → New project → paste this file
 *  2. Set the constants below (GITHUB_TOKEN, REPO, FOLDER_ID, etc.)
 *  3. Run setupTrigger() once to enable auto-publish on Doc changes
 *  4. Optionally deploy as Web App for a manual-trigger button
 *
 * Flow:
 *  Google Docs (in Drive folder)
 *    → this script converts Doc → Markdown + frontmatter
 *    → commits .md file to src/data/blog/ in GitHub repo via API
 *    → GitHub Actions builds Astro site → GitHub Pages serves static HTML
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // GitHub personal access token (needs repo write scope)
  // Store as Script Property: File > Project properties > Script properties
  // Key: GITHUB_TOKEN
  GITHUB_TOKEN: PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '',

  // Target GitHub repository  (owner/repo)
  REPO: 'Fi5herL/fi5herl.github.io',

  // Branch to commit to
  BRANCH: 'main',

  // Path in repo where blog posts are stored
  BLOG_PATH: 'src/data/blog',

  // Google Drive folder ID that contains the Google Docs to publish
  // Get it from the Drive folder URL: drive.google.com/drive/folders/<FOLDER_ID>
  FOLDER_ID: PropertiesService.getScriptProperties().getProperty('BLOG_FOLDER_ID') || '',

  // Default author name for frontmatter
  DEFAULT_AUTHOR: 'Fi5herL',

  // Default tags if none found in Doc
  DEFAULT_TAGS: ['general'],

  // Google Sheets ID for publish log (optional, set to '' to disable)
  LOG_SHEET_ID: PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID') || '',
};

// ─── Entry Points ─────────────────────────────────────────────────────────────

/**
 * Publish all Google Docs in the configured folder.
 * Run this manually or via trigger.
 */
function publishAll() {
  if (!CONFIG.FOLDER_ID) {
    Logger.log('ERROR: BLOG_FOLDER_ID not set in Script Properties.');
    return;
  }
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  let count = 0;
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith('_')) continue; // Skip files starting with _
    try {
      publishDoc(file.getId());
      count++;
    } catch (e) {
      Logger.log(`ERROR publishing ${file.getName()}: ${e.message}`);
    }
  }
  Logger.log(`Published ${count} articles.`);
}

/**
 * Publish a single Google Doc by its file ID.
 * @param {string} fileId - Google Drive file ID
 */
function publishDoc(fileId) {
  const file = DriveApp.getFileById(fileId);
  const docId = file.getId();
  const doc = DocumentApp.openById(docId);

  Logger.log(`Publishing: ${doc.getName()}`);

  // Convert Doc to Markdown
  const { frontmatter, body } = convertDocToMarkdown(doc, file);

  // Compose final file content
  const slug = generateSlug(doc.getName(), file.getDateCreated());
  const filename = `${slug}.md`;
  const content = `${frontmatter}\n\n${body}\n`;

  // Push to GitHub
  commitFileToGitHub(filename, content, `publish: ${doc.getName()}`);

  // Log to Sheet
  logPublish(doc.getName(), filename, file.getLastUpdated());

  Logger.log(`✓ Published ${filename}`);
  return filename;
}

// ─── Google Doc → Markdown Conversion ────────────────────────────────────────

/**
 * Convert a Google Doc to Markdown + frontmatter.
 */
function convertDocToMarkdown(doc, file) {
  const body = doc.getBody();
  const paragraphs = body.getParagraphs();

  let title = doc.getName().replace(/^\d{4}-\d{2}-\d{2}[_-]?/, '').trim();
  let description = '';
  let tags = [...CONFIG.DEFAULT_TAGS];
  let featured = false;
  let draft = false;
  const lines = [];

  paragraphs.forEach((para, idx) => {
    const text = para.getText().trim();
    const heading = para.getHeading();

    if (!text) {
      lines.push('');
      return;
    }

    // Detect special frontmatter directives in the first 5 paragraphs
    if (idx < 5) {
      if (text.startsWith('description:')) {
        description = text.replace('description:', '').trim();
        return;
      }
      if (text.startsWith('tags:')) {
        tags = text.replace('tags:', '').split(',').map(t => t.trim()).filter(Boolean);
        return;
      }
      if (text.toLowerCase() === 'featured: true') { featured = true; return; }
      if (text.toLowerCase() === 'draft: true')    { draft = true; return; }
    }

    // Map headings
    if (heading === DocumentApp.ParagraphHeading.TITLE) {
      title = text;
      return;
    }
    if (heading === DocumentApp.ParagraphHeading.HEADING1) {
      lines.push(`# ${text}`);
      return;
    }
    if (heading === DocumentApp.ParagraphHeading.HEADING2) {
      if (!description) description = text;
      lines.push(`## ${text}`);
      return;
    }
    if (heading === DocumentApp.ParagraphHeading.HEADING3) {
      lines.push(`### ${text}`);
      return;
    }
    if (heading === DocumentApp.ParagraphHeading.HEADING4) {
      lines.push(`#### ${text}`);
      return;
    }

    // Convert inline styles
    lines.push(convertParagraphToMarkdown(para));
  });

  // Extract description from first content line if not set
  if (!description) {
    for (const line of lines) {
      const clean = line.replace(/^#+\s*/, '').trim();
      if (clean.length > 10) {
        description = clean.slice(0, 120) + (clean.length > 120 ? '...' : '');
        break;
      }
    }
  }
  if (!description) description = title;

  const pubDatetime = new Date(file.getDateCreated()).toISOString();
  const tagYaml = tags.map(t => `  - ${t}`).join('\n');

  const frontmatter = `---
author: ${CONFIG.DEFAULT_AUTHOR}
pubDatetime: ${pubDatetime}
title: "${title.replace(/"/g, '\\"')}"
featured: ${featured}
draft: ${draft}
tags:
${tagYaml}
description: "${description.replace(/"/g, '\\"')}"
---`;

  return { frontmatter, body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/**
 * Convert a single paragraph's inline styles to Markdown.
 */
function convertParagraphToMarkdown(para) {
  let md = '';
  const numChildren = para.getNumChildren();

  for (let i = 0; i < numChildren; i++) {
    const child = para.getChild(i);
    if (child.getType() === DocumentApp.ElementType.TEXT) {
      const textEl = child.asText();
      const text = textEl.getText();

      let j = 0;
      while (j < text.length) {
        const isBold   = textEl.isBold(j);
        const isItalic = textEl.isItalic(j);
        const isCode   = textEl.getFontFamily(j) === 'Courier New';
        const link     = textEl.getLinkUrl(j);

        // Find run end
        let k = j + 1;
        while (k < text.length &&
               textEl.isBold(k) === isBold &&
               textEl.isItalic(k) === isItalic &&
               (textEl.getFontFamily(k) === 'Courier New') === isCode &&
               textEl.getLinkUrl(k) === link) {
          k++;
        }

        let chunk = text.slice(j, k);
        if (isCode)   chunk = '`' + chunk + '`';
        if (isBold)   chunk = '**' + chunk + '**';
        if (isItalic) chunk = '_' + chunk + '_';
        if (link)     chunk = `[${chunk}](${link})`;

        md += chunk;
        j = k;
      }
    }
  }

  return md;
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

/**
 * Commit (create or update) a file to the GitHub repo.
 */
function commitFileToGitHub(filename, content, commitMessage) {
  const token = CONFIG.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set in Script Properties.');

  const path = `${CONFIG.BLOG_PATH}/${filename}`;
  const apiUrl = `https://api.github.com/repos/${CONFIG.REPO}/contents/${path}`;

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Fi5herBlog-GAS-Publisher/1.0',
  };

  // Check if file already exists (to get its SHA for update)
  let sha = null;
  try {
    const checkResp = UrlFetchApp.fetch(apiUrl, { headers, muteHttpExceptions: true });
    if (checkResp.getResponseCode() === 200) {
      sha = JSON.parse(checkResp.getContentText()).sha;
    }
  } catch (e) {
    // File doesn't exist yet, that's fine
  }

  const encodedContent = Utilities.base64Encode(
    Utilities.newBlob(content).getBytes()
  );

  const payload = {
    message: commitMessage,
    content: encodedContent,
    branch: CONFIG.BRANCH,
  };
  if (sha) payload.sha = sha;

  const response = UrlFetchApp.fetch(apiUrl, {
    method: 'PUT',
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub API error ${code}: ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a document name + date.
 */
function generateSlug(docName, date) {
  const d = new Date(date);
  const datePrefix = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Remove date prefix if already in the name
  let name = docName.replace(/^\d{4}-\d{2}-\d{2}[_-]?/, '').trim();

  // Convert to URL-safe slug
  const slug = name
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')   // spaces → dash
    .replace(/[^\w\u4e00-\u9fa5-]/g, '') // keep alphanumeric, CJK, dash
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return `${datePrefix}-${slug || 'post'}`;
}

/**
 * Log a publish action to a Google Sheet (if configured).
 */
function logPublish(docName, filename, updatedAt) {
  if (!CONFIG.LOG_SHEET_ID) return;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    const sheet = ss.getSheetByName('publish_log') || ss.insertSheet('publish_log');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Doc Name', 'Filename', 'Last Updated']);
    }
    sheet.appendRow([new Date(), docName, filename, updatedAt]);
  } catch (e) {
    Logger.log(`Warning: Could not write to log sheet: ${e.message}`);
  }
}

// ─── Trigger Setup ────────────────────────────────────────────────────────────

/**
 * Set up a time-driven trigger to auto-publish every hour.
 * Run this function once from the Apps Script editor.
 */
function setupTrigger() {
  // Remove existing triggers first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'publishAll') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create a new hourly trigger
  ScriptApp.newTrigger('publishAll')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✓ Hourly trigger set up for publishAll().');
}

/**
 * Remove all triggers (for cleanup).
 */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('All triggers removed.');
}

// ─── Web App Entry Point (optional manual trigger button) ─────────────────────

/**
 * Deploy as Web App to get a URL you can call to trigger publish.
 * In GAS editor: Deploy > New deployment > Web app
 * Access: Anyone (or only yourself)
 */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'publishAll') {
    publishAll();
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, message: 'Published all docs.' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'publishOne' && e.parameter.fileId) {
    const filename = publishDoc(e.parameter.fileId);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, filename })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Default: return status
  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      message: 'Fi5her Blog Publisher. Use ?action=publishAll or ?action=publishOne&fileId=xxx',
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
