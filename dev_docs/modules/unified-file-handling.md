# Unified File Handling System

## Overview

The unified file handling system provides consistent, secure, and robust file operations across the SCORM Tester application. This system resolves the persistent file loading issues by centralizing path resolution, URL generation, and content serving.

## Architecture

### Core Components

1. **Path Utilities** (`src/shared/utils/path-utils.js`)
   - Cross-platform path normalization
   - Secure path validation
   - SCORM content URL resolution
   - Protocol URL conversion

2. **Enhanced Custom Protocol Handler** (`src/main/services/window-manager.js`)
   - Simplified `scorm-app://` protocol registration
   - Robust path validation using PathUtils
   - Comprehensive error handling

3. **Updated File Manager** (`src/main/services/file-manager.js`)
   - Integrated PathUtils for all path operations using `getTempRoot()` and `normalize()`
   - Consolidated manifest handling with single `getManifestInfo()` method
   - Modular ZIP extraction with focused security validation methods
   - Removed redundant LMS files copying (SCORM API provided by application)

4. **Simplified Renderer Logic** (`src/renderer/app.js`)
   - Clean content loading implementation
   - Removed complex debugging code
   - Proper error handling and user feedback

## Key Features

### 1. Consistent Path Resolution

All path operations use the centralized `PathUtils` class:

```javascript
// Normalize paths across platforms
const normalizedPath = PathUtils.normalize(filePath);

// Get consistent temp root directory
const tempRoot = PathUtils.getTempRoot();

// Validate path within allowed root
const isValid = PathUtils.isValidPath(resolvedPath, allowedRoot, nativePath);

// Resolve SCORM content URLs
const urlResult = PathUtils.resolveScormContentUrl(contentPath, extractionPath, appRoot);

// Convert to protocol URL
const protocolUrl = PathUtils.toScormProtocolUrl(filePath, appRoot);
```

### 2. Security Validation

All paths are validated for security:
- Path traversal prevention
- Boundary checking against app root
- File existence validation
- Sanitization of user inputs

### 3. Error Handling

Comprehensive error handling with clear user feedback:
- Detailed error messages for debugging
- Graceful fallbacks for common issues
- User-friendly error displays

## Implementation Details

### Path Resolution Flow (Updated)

All course sources (zip files, selected folders, and drag/drop temporaries) are prepared into a canonical working directory under the application's canonical temp root: os.tmpdir()/scorm-tester/scorm_<id>. This is now the single supported external base for the renderer and protocol handler. Key points:

- Zip packages are extracted into a unique directory under the canonical temp root (existing extractScorm behavior).
- User-selected folders are validated (must contain imsmanifest.xml) and then copied into a unique directory under the canonical temp root.
- Drag & drop files are saved as temporary files and processed the same as zip/temp sources.
- After preparation, renderer and CAM services always operate against the canonical working directory (unifiedPath) — the app never serves files directly from arbitrary user-selected folders.

Benefits:
- Simplifies protocol handling and eliminates fragile 'abs' heuristics.
- Removes special-case allowedBase logic in renderer code.
- Improves security by constraining served files to app root + canonical temp root only.

Updated flow:

1. **SCORM Package Extraction**
   - File Manager extracts package to `temp/scorm_[timestamp]/`
   - Validates extraction path within app boundaries

2. **Entry Point Discovery**
   - Parses `imsmanifest.xml` for SCO resources
   - Uses PathUtils to resolve relative paths
   - Generates `scorm-app://` protocol URLs

3. **Content Loading**
   - Renderer receives pre-resolved URLs
   - Custom protocol handler serves files securely
   - SCORM API injection for content communication

### URL Format

The system uses a consistent URL format:
```
scorm-app://temp/scorm_1234567890/shared/launchpage.html?content=playing
```

Where:
- `scorm-app://` - Custom protocol for secure file serving
- `temp/scorm_1234567890/` - Extraction directory relative to app root
- `shared/launchpage.html` - Content file path
- `?content=playing` - Query parameters preserved

## API Reference

### PathUtils Class

#### Core Methods

#### `normalize(filePath)`
Normalizes file paths for cross-platform compatibility. Converts backslashes to forward slashes, removes duplicate slashes, and removes trailing slashes (except root).

**Parameters:**
- `filePath` (string) - Path to normalize

**Returns:** 
- (string) Normalized path

#### `getTempRoot()`
Gets the normalized canonical temp root directory for SCORM extractions.

**Returns:**
- (string) Normalized temp root path (`os.tmpdir()/scorm-tester`)

#### `isValidPath(resolvedPath, allowedRoot, nativePath)`
Checks if a resolved path is within allowed root boundaries and exists on filesystem.

**Parameters:**
- `resolvedPath` (string) - The normalized resolved path  
- `allowedRoot` (string) - The allowed root directory
- `nativePath` (string) - The native file path for existence check

**Returns:**
- (boolean) True if path is valid and exists

#### Content Resolution Methods

#### `resolveScormContentUrl(contentPath, extractionPath, appRoot)`
Resolves SCORM content paths to loadable URLs with comprehensive validation.

**Parameters:**
- `contentPath` (string) - Content path from manifest (may include query parameters)
- `extractionPath` (string) - SCORM extraction directory (must be under canonical temp root)
- `appRoot` (string) - Application root directory

**Returns:**
- (Object) Resolution result with URL and metadata:
  ```javascript
  {
    success: boolean,
    url?: string,           // Protocol URL if successful
    resolvedPath?: string,  // Final resolved file path
    originalPath: string,   // Input content path
    hasQuery?: boolean,     // Whether query parameters were present
    queryString?: string,   // Query parameters if present
    usedBase?: string,      // 'appRoot' or 'tempRoot'
    error?: string         // Error message if failed
  }
  ```

#### `toScormProtocolUrl(filePath, appRoot)`
Converts file system paths to `scorm-app://` protocol URLs with intelligent same-origin handling for SCORM content.

**Parameters:**
- `filePath` (string) - Absolute file system path
- `appRoot` (string) - Application root directory

**Returns:**
- (string) Protocol URL (uses `scorm-app://index.html/` prefix for SCORM content under temp root)

#### Protocol Handling

#### `handleProtocolRequest(protocolUrl, appRoot)`
Handles custom protocol requests with comprehensive path processing and validation.

**Parameters:**
- `protocolUrl` (string) - Full protocol URL (e.g., 'scorm-app://temp/file.html')
- `appRoot` (string) - Application root directory

**Returns:**
- (Object) Processing result:
  ```javascript
  {
    success: boolean,
    resolvedPath?: string,    // Final resolved path if successful
    requestedPath: string,    // Requested path portion
    queryString?: string,     // Query parameters if present
    usedBase?: string,       // 'appRoot' or 'tempRoot'
    error?: string,          // Error message if failed
    isUndefinedPath?: boolean // Special flag for undefined path detection
  }
  ```

#### Utility Methods

#### `validatePath(filePath, allowedRoot)`
Validates paths for security and existence with path traversal protection.

**Parameters:**
- `filePath` (string) - Path to validate
- `allowedRoot` (string) - Root directory constraint

**Returns:**
- (boolean) True if path is valid and safe

#### `getAppRoot(currentDir)`
Gets normalized application root directory by navigating up from current directory.

**Parameters:**
- `currentDir` (string) - Current directory (usually `__dirname`)

**Returns:**
- (string) Normalized application root path

#### `getPreloadPath(currentDir)`
Resolves preload script path relative to current directory.

**Parameters:**
- `currentDir` (string) - Current directory (usually `__dirname`)

**Returns:**
- (string) Resolved preload script path

#### `fileExists(filePath)`
Checks if file exists at specified path.

**Parameters:**
- `filePath` (string) - Path to check

**Returns:**
- (boolean) True if file exists

## Integration Points

### Main Process

1. **File Manager** uses PathUtils extensively:
   - `getTempRoot()` for consistent temp directory handling
   - `normalize()` for cross-platform path compatibility
   - `isValidPath()` for security validation
   - Modular ZIP extraction with focused validation methods
2. **Window Manager** uses PathUtils in custom protocol handler
3. **IPC Handlers** expose path utilities to renderer process

### Renderer Process

1. **App.js** uses simplified content loading logic
2. **Preload API** provides access to path utilities
3. **Error handling** shows user-friendly messages

## Migration from Legacy System

### Before (Complex Debug Code)
```javascript
// Complex path resolution with extensive debugging
let fullContentPath = contentUrl;
if (!contentUrl.includes('\\') && !contentUrl.includes('/')) {
  // Complex path construction logic...
}
// Multiple fallback mechanisms...
```

### After (Unified System)
```javascript
// Simple, reliable path resolution
const contentUrl = courseData.launchUrl; // Already resolved by PathUtils
contentFrame.src = contentUrl;
```

## Benefits

### 1. Reliability
- Eliminates path-related loading failures
- Consistent behavior across different SCORM packages
- Robust handling of edge cases

### 2. Maintainability
- Centralized path logic