# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Windows desktop application built with Electron for testing and previewing SCORM (Sharable Content Object Reference Model) courses with full LMS simulation capabilities. The application provides offline SCORM testing, real-time debugging, and compliance validation for multiple LMS environments including Litmos, Moodle, SCORM Cloud, and Generic LMS.

## Common Commands

### Development
- `npm run dev` - Start application in development mode
- `npm run dev-debug` - Start with NODE_ENV=development for enhanced debugging
- `npm start` - Start application in production mode

### Testing and Quality
- `npm test` - Run Jest test suite (includes SCORM API, security, and performance tests)
- `npm run lint` - Run ESLint code linting

### Build and Distribution
- `npm run build` - Build distributable packages with electron-builder
- `npm run dist` - Build without publishing (for local testing)

## Architecture

### Core Structure
- **main.js** - Main Electron process with IPC handlers and security validation
- **preload.js** - Security-hardened preload script with input validation and XSS prevention
- **app.js** - Frontend SCORM API implementation with synchronous behavior
- **index.html** - Primary application interface
- **debug.html** - Debug console window for real-time SCORM API monitoring

### Key Utilities
- **utils/scorm-api-handler.js** - SCORM 1.2 and 2004 API implementation with local caching
- **utils/path-utils.js** - Cross-platform path handling with directory traversal protection
- **config/production.js** - Production configuration with resource management
- **monitoring/index.js** - Performance monitoring and health checks

### LMS Profile System
The application simulates different LMS environments with specific constraints:
- **Litmos LMS**: 4KB suspend data limit, strict validation
- **Moodle**: 64KB suspend data limit, relaxed validation  
- **SCORM Cloud**: 64KB suspend data limit, strict validation
- **Generic LMS**: 4KB suspend data limit, configurable settings

### Security Architecture
- Context isolation enabled with secure IPC communication
- Comprehensive input validation for all operations
- HTML escaping for XSS prevention
- Path security with directory traversal protection
- Rate limiting to prevent API abuse

### Performance Features
- Memory-safe session management with automatic cleanup
- Local caching for immediate SCORM API responses
- Background synchronization for data persistence
- Resource management with temporary file cleanup
- Performance tracking with configurable health thresholds

## Testing Framework

Uses Jest with comprehensive test coverage including:
- SCORM API compliance testing (both 1.2 and 2004)
- Security validation and XSS prevention
- Input validation and error handling
- Memory management and performance testing
- LMS profile-specific constraint testing

Run individual test suites:
- `npm test -- --testPathPattern=scorm-api` - SCORM API tests only

## Development Patterns

### SCORM API Implementation
- Synchronous API behavior to maintain SCORM compliance
- Local caching with background sync for performance
- Multi-version support (SCORM 1.2 and 2004)
- Proper SCORM error codes and recovery mechanisms

### Error Handling
- Comprehensive error boundaries at all levels
- SCORM-compliant error codes and messages
- Automatic recovery mechanisms where possible
- Detailed logging for debugging and monitoring

### Resource Management
- Automatic cleanup of extracted SCORM packages
- Memory monitoring with configurable thresholds
- Session isolation to prevent data contamination
- Performance tracking and optimization

## Key Dependencies

- **Electron 28.0.0** - Desktop application framework
- **node-stream-zip 1.15.0** - ZIP extraction for SCORM packages
- **Jest 29.0.0** - Testing framework
- **ESLint 8.0.0** - Code linting
- **electron-builder 24.13.3** - Application packaging

## File Operations

SCORM packages can be loaded as:
- ZIP files (automatically extracted to temp directory)
- Directories (direct folder access)
- Supports nested package structures and manifest parsing

All file operations include path validation and security checks to prevent directory traversal attacks.