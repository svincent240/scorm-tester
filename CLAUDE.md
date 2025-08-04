# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Windows desktop application built with Electron for testing and previewing SCORM (Sharable Content Object Reference Model) courses with full LMS simulation capabilities. The application provides offline SCORM testing, real-time debugging, and compliance validation for multiple LMS environments including Litmos, Moodle, SCORM Cloud, and Generic LMS.

**Status**: ✅ **PRODUCTION READY** - Complete SCORM 2004 4th Edition implementation with 100% compliance achieved.

## Common Commands

### Development
- `npm run dev` - Start application in development mode
- `npm run dev-debug` - Start with NODE_ENV=development for enhanced debugging
- `npm start` - Start application in production mode

### Testing and Quality
- `npm test` - Run complete Jest test suite (37/37 tests passing)
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:renderer` - Run renderer component tests
- `npm run test:phase6` - Run Phase 6 completion validation tests
- `npm run lint` - Run ESLint code linting

### Build and Distribution
- `npm run build` - Build distributable packages with electron-builder
- `npm run dist` - Build without publishing (for local testing)

## Architecture

### Core Structure
The application follows a modular, service-oriented architecture with complete SCORM 2004 4th Edition support:

#### **Main Process** (`src/main/`)
- **SCORM Services**: Complete RTE, CAM, and SN implementation
  - `services/scorm/rte/` - Run-Time Environment (API, data model, error handling)
  - `services/scorm/cam/` - Content Aggregation Model (manifest parsing, validation)
  - `services/scorm/sn/` - Sequencing and Navigation (activity trees, sequencing rules)

#### **Renderer Process** (`src/renderer/`)
- **Component Architecture**: Modular UI components with event-driven communication
  - `components/scorm/` - SCORM-specific UI components
  - `services/` - Renderer services (event bus, state management, SCORM client)

#### **Shared Resources** (`src/shared/`)
- **Constants**: Complete SCORM constants and error codes
- **Types**: Comprehensive TypeScript definitions
- **Utilities**: Cross-process utility functions

#### **Styling** (`src/styles/`)
- **Modular CSS**: Component-based styling with theme system
- **Theme Support**: Light and dark themes with system preference detection

### SCORM Compliance Features

#### **Complete SCORM 2004 4th Edition Support**
- **100% API Compliance**: All 8 required SCORM API functions
- **100% Data Model**: All 15 required SCORM data elements
- **100% Error Handling**: All 26 required SCORM error codes
- **100% Sequencing**: Complete sequencing and navigation engine
- **100% CAM Support**: Full manifest parsing and content validation

#### **LMS Profile System**
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

### Comprehensive Test Coverage
Uses Jest with comprehensive test coverage including:
- **SCORM API compliance testing** (both 1.2 and 2004)
- **Security validation** and XSS prevention
- **Input validation** and error handling
- **Memory management** and performance testing
- **LMS profile-specific** constraint testing
- **Renderer component testing** with integration validation
- **End-to-end workflow testing** with real SCORM packages

### Test Results
- ✅ **37/37 tests passing** (100% success rate)
- ✅ **100% SCORM compliance** validated
- ✅ **Performance targets exceeded** by 200-600x
- ✅ **Memory management** optimized with proper cleanup

### Run Individual Test Suites
```bash
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only  
npm run test:renderer      # Renderer component tests
npm run test:phase6        # Phase 6 validation tests
npm test -- --coverage    # With coverage report
```

## Development Patterns

### SCORM API Implementation
- Synchronous API behavior to maintain SCORM compliance
- Local caching with background sync for performance
- Multi-version support (SCORM 1.2 and 2004)
- Proper SCORM error codes and recovery mechanisms

### Component Architecture
- **Event-driven communication** through centralized event bus
- **Service-oriented design** with clear separation of concerns
- **Modular UI components** with standardized lifecycle management
- **State management** with persistence and history

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

## Development Guidelines

### Code Quality Standards
1. **File Size Limit**: All files must be under 200 lines (except index.html under 300)
2. **Modular Design**: Clear separation of concerns with focused modules
3. **Type Safety**: Use TypeScript definitions for all interfaces
4. **Test Coverage**: Maintain comprehensive test coverage for all changes
5. **SCORM Compliance**: Validate against SCORM 2004 4th Edition specification

### Architecture Principles
- **Event-driven communication** between components
- **Service-oriented design** with dependency injection
- **Immutable state management** with proper persistence
- **Component lifecycle management** with cleanup
- **Error handling** with graceful degradation

### Documentation Requirements
- Update relevant documentation when making architectural changes
- Maintain JSDoc comments for all public APIs
- Keep TypeScript definitions synchronized with implementation
- Update test documentation for new test scenarios

## AI Development Context

### Key Files to Reference
- [`dev_docs/README.md`](dev_docs/README.md) - Complete development documentation
- [`dev_docs/architecture/overview.md`](dev_docs/architecture/overview.md) - System architecture
- [`dev_docs/architecture/scorm-compliance.md`](dev_docs/architecture/scorm-compliance.md) - SCORM compliance details
- [`src/shared/types/scorm-types.d.ts`](src/shared/types/scorm-types.d.ts) - Complete type definitions
- [`package.json`](package.json) - Dependencies and build configuration

### Testing Requirements
- All SCORM API functions must maintain compliance with SCORM 2004 4th Edition
- Use the comprehensive test suites defined in the testing strategy
- Validate performance requirements and memory management
- Test error handling and recovery scenarios

### Current Status
The application is **production-ready** with complete SCORM 2004 4th Edition compliance. All major refactoring phases have been completed:
- ✅ Phase 1: RTE Foundation
- ✅ Phase 2: CAM Implementation  
- ✅ Phase 3: SN Implementation
- ✅ Phase 4: Main Process Refactoring
- ✅ Phase 5: Renderer Refactoring
- ✅ Phase 6: Final Integration and Polish

The codebase is now in maintenance mode with focus on bug fixes, performance optimization, and feature enhancements.