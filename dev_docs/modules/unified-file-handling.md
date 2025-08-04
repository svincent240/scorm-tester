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
   - Integrated path utilities for SCORM entry resolution
   - Consistent URL generation for content
   - Enhanced manifest parsing with proper path handling

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

### Path Resolution Flow

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

#### `normalize(filePath)`
Normalizes file paths for cross-platform compatibility.

**Parameters:**
- `filePath` (string) - Path to normalize

**Returns:** 
- (string) Normalized path

#### `resolveScormContentUrl(contentPath, extractionPath, appRoot)`
Resolves SCORM content paths to loadable URLs.

**Parameters:**
- `contentPath` (string) - Content path from manifest
- `extractionPath` (string) - SCORM extraction directory
- `appRoot` (string) - Application root directory

**Returns:**
- (Object) Resolution result with URL and metadata

#### `toScormProtocolUrl(filePath, appRoot)`
Converts file system paths to `scorm-app://` protocol URLs.

**Parameters:**
- `filePath` (string) - Absolute file system path
- `appRoot` (string) - Application root directory

**Returns:**
- (string) Protocol URL

#### `validatePath(filePath, allowedRoot)`
Validates paths for security and existence.

**Parameters:**
- `filePath` (string) - Path to validate
- `allowedRoot` (string) - Root directory constraint

**Returns:**
- (boolean) True if path is valid and safe

## Integration Points

### Main Process

1. **File Manager** uses PathUtils for entry point resolution
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