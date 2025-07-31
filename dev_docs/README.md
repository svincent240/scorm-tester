# SCORM Tester - Developer Documentation

## 🤖 AI Development Context

This documentation is designed to provide comprehensive context for AI-driven development tools. Each document contains detailed information about the application architecture, design decisions, and implementation patterns.

## 📋 Quick Reference

### Application Overview
- **Purpose**: Desktop SCORM package testing tool (similar to SCORM Cloud but for local/offline use)
- **Technology**: Electron-based desktop application
- **SCORM Compliance**: SCORM 2004 4th Edition fully compliant
- **Architecture**: Modular, service-oriented design with clear separation of concerns

### Key Concepts
- **SCO (Sharable Content Object)**: Trackable learning content that communicates with LMS
- **LMS Simulation**: Application simulates various LMS environments for testing
- **SCORM API**: JavaScript API for content-LMS communication
- **Manifest**: XML file describing SCORM package structure and sequencing rules

## 📚 Documentation Structure

### Core Architecture
- [`architecture/overview.md`](architecture/overview.md) - High-level system architecture
- [`architecture/scorm-compliance.md`](architecture/scorm-compliance.md) - SCORM 2004 4th Edition implementation details
- [`architecture/data-flow.md`](architecture/data-flow.md) - Data flow and communication patterns
- [`architecture/security-model.md`](architecture/security-model.md) - Security considerations and implementation

### Module Documentation
- [`modules/main-process.md`](modules/main-process.md) - Main Electron process services
- [`modules/renderer-process.md`](modules/renderer-process.md) - Renderer process components
- [`modules/scorm-engine.md`](modules/scorm-engine.md) - SCORM API and data model implementation
- [`modules/content-processing.md`](modules/content-processing.md) - Manifest parsing and content validation
- [`modules/sequencing-navigation.md`](modules/sequencing-navigation.md) - SCORM sequencing and navigation engine

### API Reference
- [`api/scorm-api.md`](api/scorm-api.md) - SCORM API implementation reference
- [`api/ipc-interface.md`](api/ipc-interface.md) - Inter-process communication interface
- [`api/data-models.md`](api/data-models.md) - Data structures and type definitions

### Development Guides
- [`guides/development-setup.md`](guides/development-setup.md) - Development environment setup
- [`guides/testing-strategy.md`](guides/testing-strategy.md) - Testing approach and compliance validation
- [`guides/debugging.md`](guides/debugging.md) - Debugging SCORM content and application issues
- [`guides/extending.md`](guides/extending.md) - Adding new features and LMS profiles

## 🔄 Refactoring Documentation (Temporary)

### Current Refactoring Project
- [`refactor/migration-plan.md`](refactor/migration-plan.md) - Complete refactoring roadmap
- [`refactor/phase-1-foundation.md`](refactor/phase-1-foundation.md) - Core SCORM infrastructure
- [`refactor/phase-2-content-processing.md`](refactor/phase-2-content-processing.md) - Manifest and content handling
- [`refactor/phase-3-sequencing.md`](refactor/phase-3-sequencing.md) - Sequencing and navigation engine
- [`refactor/phase-4-main-process.md`](refactor/phase-4-main-process.md) - Main process modularization
- [`refactor/phase-5-renderer.md`](refactor/phase-5-renderer.md) - UI component refactoring
- [`refactor/phase-6-polish.md`](refactor/phase-6-polish.md) - Styling and final improvements

## 🎯 AI Tool Guidelines

### When Working on This Codebase
1. **Always read the architecture overview first** to understand the system design
2. **Check SCORM compliance requirements** before making changes to core functionality
3. **Follow the modular patterns** established in the architecture documentation
4. **Maintain file size limits** (max 200 lines per file as specified in refactor plan)
5. **Update documentation** when making architectural changes

### Key Files to Reference
- [`logging-docs.md`](../logging-docs.md) - Application logging patterns
- [`references/spec_guide_2.md`](../references/spec_guide_2.md) - SCORM 2004 4th Edition specification
- [`package.json`](../package.json) - Dependencies and build configuration

### Testing Requirements
- All SCORM API functions must maintain compliance with SCORM 2004 4th Edition
- Browser testing is disabled for this application (see rules in `.kilocode/rules/`)
- Use the comprehensive test suites defined in the testing strategy

## 🚀 Getting Started for AI Tools

1. **Read the architecture overview** to understand the current and target state
2. **Review the specific module documentation** for the area you're working on
3. **Check the refactor plan** if working on modernization efforts
4. **Validate SCORM compliance** for any changes to core SCORM functionality
5. **Update relevant documentation** when making changes

## 📞 Support and Context

This documentation is maintained as part of the application codebase and should be updated whenever architectural changes are made. The refactor documentation is temporary and will be archived once the modernization is complete.

For questions about SCORM compliance, refer to the specification guide and compliance documentation. For architectural decisions, see the detailed module documentation and design rationale sections.