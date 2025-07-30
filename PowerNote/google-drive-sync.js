/**
 * PowerNote Google Drive Sync Service
 * Google Apps Script backend for syncing workspace data
 */

// Configuration
const CONFIG_FOLDER_NAME = 'NoteConfig.md';
const WORKSPACE_FILE_PREFIX = 'PowerNote-Workspace-';

/**
 * Handle GET requests with CORS support
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    switch(action) {
      case 'auth':
        return handleAuth();
      case 'list':
        return handleListWorkspaces();
      default:
        return createResponse(false, 'Invalid action');
    }
  } catch (error) {
    console.error('doGet error:', error);
    return createResponse(false, error.toString());
  }
}

/**
 * Handle POST requests for upload operations
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    switch(action) {
      case 'upload':
        return handleUploadWorkspace(data.workspaceData, data.fileName);
      case 'download':
        return handleDownloadWorkspace(data.fileId);
      default:
        return createResponse(false, 'Invalid action');
    }
  } catch (error) {
    console.error('doPost error:', error);
    return createResponse(false, error.toString());
  }
}

/**
 * Handle authentication check
 */
function handleAuth() {
  try {
    const user = Session.getActiveUser();
    const email = user.getEmail();
    
    if (email) {
      return createResponse(true, 'Authenticated', {
        email: email,
        hasAccess: true
      });
    } else {
      return createResponse(false, 'Not authenticated');
    }
  } catch (error) {
    return createResponse(false, 'Authentication failed: ' + error.toString());
  }
}

/**
 * Get or create the NoteConfig.md folder
 */
function getOrCreateConfigFolder() {
  try {
    // Search for existing folder
    const folders = DriveApp.getFoldersByName(CONFIG_FOLDER_NAME);
    
    if (folders.hasNext()) {
      const folder = folders.next();
      console.log('Found existing config folder:', folder.getId());
      return folder;
    }
    
    // Create new folder if not exists
    const newFolder = DriveApp.createFolder(CONFIG_FOLDER_NAME);
    console.log('Created new config folder:', newFolder.getId());
    return newFolder;
    
  } catch (error) {
    console.error('Error getting/creating config folder:', error);
    throw error;
  }
}

/**
 * Handle workspace upload
 */
function handleUploadWorkspace(workspaceData, fileName) {
  try {
    const configFolder = getOrCreateConfigFolder();
    
    // Generate filename if not provided
    if (!fileName) {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      fileName = `${WORKSPACE_FILE_PREFIX}${timestamp}.json`;
    }
    
    // Ensure .json extension
    if (!fileName.endsWith('.json')) {
      fileName += '.json';
    }
    
    // Create the workspace file
    const workspaceBlob = Utilities.newBlob(
      JSON.stringify(workspaceData, null, 2),
      'application/json',
      fileName
    );
    
    const file = configFolder.createFile(workspaceBlob);
    
    console.log('Uploaded workspace file:', file.getId(), fileName);
    
    return createResponse(true, 'Workspace uploaded successfully', {
      fileId: file.getId(),
      fileName: fileName,
      uploadDate: new Date().toISOString(),
      folderId: configFolder.getId()
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return createResponse(false, 'Upload failed: ' + error.toString());
  }
}

/**
 * Handle listing all workspace files
 */
function handleListWorkspaces() {
  try {
    const configFolder = getOrCreateConfigFolder();
    const files = configFolder.getFilesByType(MimeType.PLAIN_TEXT);
    const workspaces = [];
    
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      
      // Only include workspace files
      if (fileName.includes(WORKSPACE_FILE_PREFIX) && fileName.endsWith('.json')) {
        workspaces.push({
          fileId: file.getId(),
          fileName: fileName,
          lastModified: file.getLastUpdated().toISOString(),
          size: file.getSize(),
          description: file.getDescription() || ''
        });
      }
    }
    
    // Sort by last modified date (newest first)
    workspaces.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    return createResponse(true, 'Workspaces listed successfully', {
      workspaces: workspaces,
      count: workspaces.length,
      folderId: configFolder.getId()
    });
    
  } catch (error) {
    console.error('List workspaces error:', error);
    return createResponse(false, 'Failed to list workspaces: ' + error.toString());
  }
}

/**
 * Handle workspace download
 */
function handleDownloadWorkspace(fileId) {
  try {
    if (!fileId) {
      return createResponse(false, 'File ID is required');
    }
    
    const file = DriveApp.getFileById(fileId);
    const content = file.getBlob().getDataAsString();
    
    let workspaceData;
    try {
      workspaceData = JSON.parse(content);
    } catch (parseError) {
      return createResponse(false, 'Invalid workspace file format');
    }
    
    return createResponse(true, 'Workspace downloaded successfully', {
      workspaceData: workspaceData,
      fileName: file.getName(),
      lastModified: file.getLastUpdated().toISOString(),
      fileId: fileId
    });
    
  } catch (error) {
    console.error('Download error:', error);
    
    if (error.toString().includes('not found')) {
      return createResponse(false, 'Workspace file not found');
    }
    
    return createResponse(false, 'Download failed: ' + error.toString());
  }
}

/**
 * Delete a workspace file
 */
function deleteWorkspace(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    
    return createResponse(true, 'Workspace deleted successfully', {
      fileId: fileId
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    return createResponse(false, 'Delete failed: ' + error.toString());
  }
}

/**
 * Get folder sharing URL for debugging
 */
function getFolderInfo() {
  try {
    const configFolder = getOrCreateConfigFolder();
    
    return createResponse(true, 'Folder info retrieved', {
      folderId: configFolder.getId(),
      folderName: configFolder.getName(),
      folderUrl: configFolder.getUrl(),
      created: configFolder.getDateCreated().toISOString()
    });
    
  } catch (error) {
    return createResponse(false, 'Failed to get folder info: ' + error.toString());
  }
}

/**
 * Create standardized response object with CORS headers
 */
function createResponse(success, message, data = null) {
  const response = {
    success: success,
    message: message,
    timestamp: new Date().toISOString()
  };
  
  if (data) {
    response.data = data;
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '3600'
    });
}

/**
 * Test function for development
 */
function testSyncService() {
  console.log('Testing sync service...');
  
  // Test folder creation
  const folder = getOrCreateConfigFolder();
  console.log('Config folder ID:', folder.getId());
  
  // Test workspace upload
  const testWorkspace = {
    version: '2.4.0',
    exportDate: new Date().toISOString(),
    files: [
      {
        id: 'test-file-1',
        name: 'Test Note.md',
        content: '# Test Note\n\nThis is a test note.'
      }
    ],
    timerHistory: {},
    settings: {
      currentFontSize: 22,
      currentEditorTheme: 'default'
    }
  };
  
  const uploadResult = handleUploadWorkspace(testWorkspace, 'test-workspace.json');
  console.log('Upload result:', uploadResult.getContent());
  
  // Test listing workspaces
  const listResult = handleListWorkspaces();
  console.log('List result:', listResult.getContent());
}