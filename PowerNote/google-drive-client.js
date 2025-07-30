/**
 * PowerNote Google Drive Sync Client
 * Frontend client for communicating with Google Apps Script backend
 */

// Configuration - Replace with your actual GAS deployment URL
const GAS_DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbw3VsW0JTAWh6RFuy1EWrmQAwA646DzEa3iJSn6qm7A7bQGe5FNnsMsLdAIPkFC0N-4Nw/exec';

class GoogleDriveSync {
    constructor() {
        this.isAuthenticated = false;
        this.userInfo = null;
        this.syncModal = null;
        this.versionList = null;
        this.syncStatus = null;
        
        this.initializeElements();
        this.attachEventListeners();
    }
    
    initializeElements() {
        // Get modal elements
        this.syncModal = document.getElementById('sync-version-modal');
        this.versionList = document.getElementById('version-list');
        this.syncStatus = document.getElementById('sync-status');
        
        // Get button elements
        this.syncUploadBtn = document.getElementById('sync-upload-btn');
        this.syncDownloadBtn = document.getElementById('sync-download-btn');
        this.closeSyncVersionBtn = document.getElementById('close-sync-version-btn');
        this.closeSyncModalBtn = document.getElementById('close-sync-modal-btn');
        this.refreshVersionsBtn = document.getElementById('refresh-versions-btn');
    }
    
    attachEventListeners() {
        if (this.syncUploadBtn) {
            this.syncUploadBtn.addEventListener('click', () => this.handleUpload());
        }
        
        if (this.syncDownloadBtn) {
            this.syncDownloadBtn.addEventListener('click', () => this.handleDownload());
        }
        
        if (this.closeSyncVersionBtn) {
            this.closeSyncVersionBtn.addEventListener('click', () => this.closeModal());
        }
        
        if (this.closeSyncModalBtn) {
            this.closeSyncModalBtn.addEventListener('click', () => this.closeModal());
        }
        
        if (this.refreshVersionsBtn) {
            this.refreshVersionsBtn.addEventListener('click', () => this.loadVersions());
        }
        
        // Close modal when clicking outside
        if (this.syncModal) {
            this.syncModal.addEventListener('click', (e) => {
                if (e.target === this.syncModal) {
                    this.closeModal();
                }
            });
        }
    }
    
    /**
     * Check if GAS URL is configured
     */
    isConfigured() {
        return GAS_DEPLOYMENT_URL && GAS_DEPLOYMENT_URL !== 'YOUR_GAS_DEPLOYMENT_URL_HERE';
    }
    
    /**
     * Show configuration reminder
     */
    showConfigurationReminder() {
        const message = `請先配置 Google Apps Script 部署網址：\n\n` +
                       `1. 將 google-drive-sync.js 部署到 Google Apps Script\n` +
                       `2. 複製部署網址\n` +
                       `3. 在 google-drive-client.js 中更新 GAS_DEPLOYMENT_URL\n\n` +
                       `詳細說明請參考文件。`;
        alert(message);
        console.warn('Google Drive Sync not configured. Please set GAS_DEPLOYMENT_URL.');
    }
    
    /**
     * Show CORS error message with solutions
     */
    showCORSError() {
        const message = `❌ CORS 錯誤：無法連接到 Google Drive\n\n` +
                       `解決方案：\n\n` +
                       `1. 使用本地伺服器運行 PowerNote：\n` +
                       `   - 雙擊 start-server.bat (Windows)\n` +
                       `   - 或執行：python start-server.py\n\n` +
                       `2. 或部署到網頁伺服器（如 GitHub Pages）\n\n` +
                       `3. 確保 Google Apps Script 已正確部署\n\n` +
                       `❌ 無法直接從檔案系統 (file://) 使用同步功能`;
        
        alert(message);
        console.error('CORS Error: Cannot make requests from file:// protocol');
        
        this.showNotification('請使用本地伺服器運行 PowerNote 以啟用同步功能', 'error');
    }
    
    /**
     * Make authenticated request to GAS backend
     */
    async makeRequest(method, endpoint, data = null) {
        if (!this.isConfigured()) {
            this.showConfigurationReminder();
            return null;
        }
        
        // Check if running from file:// protocol
        if (window.location.protocol === 'file:') {
            this.showCORSError();
            return null;
        }
        
        try {
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors',
                credentials: 'omit', // Don't send cookies for CORS
            };
            
            if (data) {
                options.body = JSON.stringify(data);
            }
            
            const url = method === 'GET' ? 
                `${GAS_DEPLOYMENT_URL}?action=${endpoint}` : 
                GAS_DEPLOYMENT_URL;
            
            console.log(`Making ${method} request to:`, url);
            
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Response received:', result);
            return result;
            
        } catch (error) {
            console.error('Request failed:', error);
            
            // Handle specific CORS errors
            if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                this.showCORSError();
            } else {
                this.showNotification(`連接 Google Drive 失敗: ${error.message}`, 'error');
            }
            return null;
        }
    }
    
    /**
     * Check authentication status
     */
    async checkAuth() {
        const result = await this.makeRequest('GET', 'auth');
        if (result && result.success) {
            this.isAuthenticated = true;
            this.userInfo = result.data;
            return true;
        }
        return false;
    }
    
    /**
     * Handle upload to Google Drive
     */
    async handleUpload() {
        this.showNotification('正在上傳工作區至 Google Drive...', 'info');
        
        try {
            // Check authentication first
            if (!await this.checkAuth()) {
                this.showNotification('請先登入 Google 帳戶', 'error');
                return;
            }
            
            // Get current workspace data (same as export function)
            const workspaceData = this.getCurrentWorkspaceData();
            
            // Generate filename
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
            const fileName = `PowerNote-Workspace-${timestamp}.json`;
            
            // Upload to Google Drive
            const result = await this.makeRequest('POST', 'upload', {
                action: 'upload',
                workspaceData: workspaceData,
                fileName: fileName
            });
            
            if (result && result.success) {
                this.showNotification(`工作區已成功上傳至 Google Drive: ${fileName}`, 'success');
            } else {
                const errorMsg = result ? result.message : '上傳失敗';
                this.showNotification(`上傳失敗: ${errorMsg}`, 'error');
            }
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showNotification(`上傳失敗: ${error.message}`, 'error');
        }
    }
    
    /**
     * Handle download from Google Drive
     */
    async handleDownload() {
        try {
            // Check authentication first
            if (!await this.checkAuth()) {
                this.showNotification('請先登入 Google 帳戶', 'error');
                return;
            }
            
            // Show modal and load versions
            this.showModal();
            await this.loadVersions();
            
        } catch (error) {
            console.error('Download error:', error);
            this.showNotification(`載入版本列表失敗: ${error.message}`, 'error');
        }
    }
    
    /**
     * Load available workspace versions
     */
    async loadVersions() {
        this.showLoadingStatus();
        
        try {
            const result = await this.makeRequest('GET', 'list');
            
            if (result && result.success) {
                this.displayVersions(result.data.workspaces);
                this.showVersionList();
            } else {
                const errorMsg = result ? result.message : '載入版本列表失敗';
                this.showErrorStatus(errorMsg);
            }
            
        } catch (error) {
            console.error('Load versions error:', error);
            this.showErrorStatus(`載入版本列表失敗: ${error.message}`);
        }
    }
    
    /**
     * Display available versions in the modal
     */
    displayVersions(workspaces) {
        if (!workspaces || workspaces.length === 0) {
            this.versionList.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-cloud" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>尚未找到任何工作區備份</p>
                    <p style="font-size: 14px;">請先使用上傳功能將工作區備份至 Google Drive</p>
                </div>
            `;
            return;
        }
        
        const versionsHtml = workspaces.map(workspace => {
            const uploadDate = new Date(workspace.lastModified).toLocaleString('zh-TW');
            const fileSize = this.formatFileSize(workspace.size);
            
            return `
                <div class="version-item" data-file-id="${workspace.fileId}">
                    <div class="version-info">
                        <div class="version-name">${workspace.fileName}</div>
                        <div class="version-details">
                            <i class="fas fa-clock"></i> ${uploadDate} | 
                            <i class="fas fa-file"></i> ${fileSize}
                        </div>
                    </div>
                    <div class="version-actions">
                        <button class="version-action-btn" onclick="driveSync.downloadVersion('${workspace.fileId}')">
                            <i class="fas fa-download"></i> 載入
                        </button>
                        <button class="version-action-btn danger" onclick="driveSync.deleteVersion('${workspace.fileId}', '${workspace.fileName}')">
                            <i class="fas fa-trash"></i> 刪除
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        this.versionList.innerHTML = versionsHtml;
    }
    
    /**
     * Download and apply a specific version
     */
    async downloadVersion(fileId) {
        this.showLoadingStatus('正在下載選擇的工作區版本...');
        
        try {
            const result = await this.makeRequest('POST', 'download', {
                action: 'download',
                fileId: fileId
            });
            
            if (result && result.success) {
                const workspaceData = result.data.workspaceData;
                const fileName = result.data.fileName;
                
                // Confirm before applying
                const confirmed = confirm(
                    `確定要載入此工作區版本嗎？\n\n` +
                    `檔案: ${fileName}\n` +
                    `版本: ${workspaceData.version || '未知'}\n` +
                    `檔案數量: ${workspaceData.files ? workspaceData.files.length : 0}\n\n` +
                    `⚠️ 這將覆蓋現有的所有資料！`
                );
                
                if (confirmed) {
                    this.applyWorkspaceData(workspaceData);
                    this.showNotification(`工作區版本已成功載入: ${fileName}`, 'success');
                    this.closeModal();
                }
                
            } else {
                const errorMsg = result ? result.message : '下載失敗';
                this.showErrorStatus(`下載失敗: ${errorMsg}`);
            }
            
        } catch (error) {
            console.error('Download version error:', error);
            this.showErrorStatus(`下載失敗: ${error.message}`);
        }
    }
    
    /**
     * Delete a version from Google Drive
     */
    async deleteVersion(fileId, fileName) {
        const confirmed = confirm(`確定要刪除此工作區版本嗎？\n\n檔案: ${fileName}\n\n此操作無法復原！`);
        
        if (!confirmed) return;
        
        try {
            // Note: Delete functionality would need to be implemented in GAS backend
            this.showNotification('刪除功能尚未實現，請手動在 Google Drive 中刪除', 'warning');
            
        } catch (error) {
            console.error('Delete version error:', error);
            this.showNotification(`刪除失敗: ${error.message}`, 'error');
        }
    }
    
    /**
     * Get current workspace data (same as export function)
     */
    getCurrentWorkspaceData() {
        // This should match the exportWorkspace function logic
        return {
            version: '2.4.0',
            exportDate: new Date().toISOString(),
            files: window.files || [],
            timerHistory: window.timerHistory || {},
            settings: {
                currentFontSize: window.currentFontSize || 22,
                currentEditorTheme: window.currentEditorTheme || 'default',
                autoTimerEnabled: window.autoTimerEnabled !== false,
                currentViewMode: window.currentViewMode || 'split'
            },
            localStorage: {
                'powernote_files': localStorage.getItem('powernote_files'),
                'powernote_timer_history': localStorage.getItem('powernote_timer_history'),
                'powernote_tasks': localStorage.getItem('powernote_tasks'),
                'powernote-font-size': localStorage.getItem('powernote-font-size'),
                'powernote-editor-theme': localStorage.getItem('powernote-editor-theme')
            }
        };
    }
    
    /**
     * Apply workspace data (same as import function logic)
     */
    applyWorkspaceData(workspaceData) {
        try {
            // This should match the handleWorkspaceImport function logic
            if (workspaceData.files && Array.isArray(workspaceData.files)) {
                window.files = workspaceData.files;
            }
            
            if (workspaceData.timerHistory) {
                window.timerHistory = workspaceData.timerHistory;
            }
            
            // Apply settings
            if (workspaceData.settings) {
                const settings = workspaceData.settings;
                
                if (settings.currentFontSize && window.updateFontSize) {
                    window.updateFontSize(settings.currentFontSize);
                }
                
                if (settings.currentEditorTheme && window.selectTheme) {
                    window.selectTheme(settings.currentEditorTheme);
                }
                
                if (typeof settings.autoTimerEnabled === 'boolean') {
                    window.autoTimerEnabled = settings.autoTimerEnabled;
                }
                
                if (settings.currentViewMode && window.setViewMode) {
                    window.setViewMode(settings.currentViewMode);
                }
            }
            
            // Apply localStorage data
            if (workspaceData.localStorage) {
                Object.keys(workspaceData.localStorage).forEach(key => {
                    const value = workspaceData.localStorage[key];
                    if (value !== null && value !== undefined) {
                        localStorage.setItem(key, value);
                    }
                });
            }
            
            // Refresh UI
            if (window.renderFileList) window.renderFileList();
            
            // Load first file if available
            if (window.files && window.files.length > 0 && window.loadFile) {
                window.loadFile(window.files[0].id);
            }
            
        } catch (error) {
            console.error('Apply workspace data error:', error);
            throw error;
        }
    }
    
    /**
     * Modal control functions
     */
    showModal() {
        if (this.syncModal) {
            this.syncModal.style.display = 'block';
        }
    }
    
    closeModal() {
        if (this.syncModal) {
            this.syncModal.style.display = 'none';
        }
    }
    
    /**
     * Status display functions
     */
    showLoadingStatus(message = '正在從 Google Drive 載入版本列表...') {
        this.syncStatus.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${message}`;
        this.syncStatus.style.display = 'block';
        this.versionList.style.display = 'none';
        document.getElementById('sync-actions').style.display = 'none';
    }
    
    showVersionList() {
        this.syncStatus.style.display = 'none';
        this.versionList.style.display = 'block';
        document.getElementById('sync-actions').style.display = 'flex';
    }
    
    showErrorStatus(message) {
        this.syncStatus.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i> ${message}`;
        this.syncStatus.style.display = 'block';
        this.versionList.style.display = 'none';
        document.getElementById('sync-actions').style.display = 'flex';
    }
    
    /**
     * Utility functions
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    showNotification(message, type = 'info') {
        // Use existing notification system if available
        if (window.showNotification) {
            window.showNotification(message);
        } else {
            // Fallback to alert
            alert(message);
        }
        
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Initialize Google Drive Sync when DOM is loaded
let driveSync;
document.addEventListener('DOMContentLoaded', () => {
    driveSync = new GoogleDriveSync();
});

// Make driveSync globally available
window.driveSync = driveSync;