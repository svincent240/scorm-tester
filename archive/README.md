# SCORM Tester

> A comprehensive desktop application for testing SCORM 2004 4th Edition content packages locally

[![SCORM 2004 4th Edition](https://img.shields.io/badge/SCORM-2004%204th%20Edition-blue.svg)](https://adlnet.gov/projects/scorm/)
[![Electron](https://img.shields.io/badge/Electron-Latest-47848f.svg)](https://electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/Build-Passing-green.svg)](#)

## Overview

SCORM Tester is a powerful desktop application that simulates various Learning Management System (LMS) environments for testing SCORM 2004 4th Edition content packages locally. Similar to SCORM Cloud but designed for offline/local development and testing workflows.

### Key Features

- **🎯 Full SCORM 2004 4th Edition Compliance**
  - Complete implementation of CAM, RTE, and SN specifications
  - All 8 SCORM API functions with proper error handling
  - Comprehensive data model support (all cmi.* elements)
  - Sequencing and navigation engine

- **🔧 Multiple LMS Profile Simulation**
  - Generic SCORM 2004 4th Edition behavior
  - Moodle-specific behaviors and quirks
  - Litmos LMS simulation
  - SCORM Cloud compatibility mode

- **🐛 Advanced Debugging Tools**
  - Real-time SCORM API call monitoring
  - Data model state inspection
  - Sequencing rule evaluation tracking
  - Comprehensive error reporting and diagnostics

- **📦 Local Package Testing**
  - ZIP file extraction and validation
  - Manifest parsing and compliance checking
  - File integrity verification
  - Offline testing capabilities

## Quick Start

### Installation

#### Download Pre-built Binaries
Download the latest release for your platform:
- [Windows (x64)](https://github.com/your-org/scorm-tester/releases/latest/download/scorm-tester-win32-x64.zip)
- [macOS (Intel)](https://github.com/your-org/scorm-tester/releases/latest/download/scorm-tester-darwin-x64.zip)
- [macOS (Apple Silicon)](https://github.com/your-org/scorm-tester/releases/latest/download/scorm-tester-darwin-arm64.zip)
- [Linux (x64)](https://github.com/your-org/scorm-tester/releases/latest/download/scorm-tester-linux-x64.zip)

#### Build from Source
```bash
# Clone the repository
git clone https://github.com/your-org/scorm-tester.git
cd scorm-tester

# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build
npm run dist
```

### Basic Usage

1. **Launch the Application**
   ```bash
   npm start
   # or run the downloaded executable
   ```

2. **Load a SCORM Package**
   - Click "Open SCORM Package" or drag & drop a ZIP file
   - The application will extract and validate the package
   - View the course structure in the navigation tree

3. **Test Your Content**
   - Select an SCO from the course tree
   - Content loads in the integrated viewer
   - Monitor SCORM API calls in the debug panel
   - Navigate through the course using LMS controls

4. **Debug and Analyze**
   - View real-time API calls and data model changes
   - Inspect sequencing rule evaluations
   - Check compliance with SCORM specifications
   - Export debug logs for analysis

## SCORM 2004 4th Edition Compliance

### Supported Features

#### Content Aggregation Model (CAM)
- ✅ **Manifest Parsing**: Complete imsmanifest.xml processing
- ✅ **Content Validation**: Package structure and file integrity
- ✅ **Metadata Support**: IEEE LOM metadata extraction
- ✅ **Application Profiles**: Both Content Aggregation and Resource packages
- ✅ **Schema Validation**: XML schema compliance checking

#### Run-Time Environment (RTE)
- ✅ **SCORM API**: All 8 required functions implemented
  - `Initialize("")` - Session initialization
  - `Terminate("")` - Session termination
  - `GetValue(element)` - Data retrieval
  - `SetValue(element, value)` - Data storage
  - `Commit("")` - Data persistence
  - `GetLastError()` - Error code retrieval
  - `GetErrorString(errorCode)` - Error messages
  - `GetDiagnostic(errorCode)` - Diagnostic information

- ✅ **Data Model**: Complete cmi.* element support
  - Core elements (completion, success, exit, entry)
  - Scoring elements (scaled, raw, min, max)
  - Time tracking (session_time, total_time)
  - Location and progress tracking
  - Suspend data (up to 64k characters)
  - Collections (interactions, objectives)
  - Navigation elements (adl.nav.*)

- ✅ **Error Handling**: All SCORM error codes (0-999)
  - Proper error categorization and reporting
  - Diagnostic information for debugging
  - Session state validation

#### Sequencing and Navigation (SN)
- ✅ **Activity Tree**: Runtime course structure management
- ✅ **Sequencing Rules**: Preconditions, postconditions, exit actions
- ✅ **Navigation Processing**: All navigation request types
- ✅ **Rollup Behaviors**: Objective and progress aggregation
- ✅ **Limit Conditions**: Attempt limits and time constraints
- ✅ **Control Modes**: Choice, flow, and forward-only navigation

### Compliance Testing

The application includes comprehensive compliance testing:

```bash
# Run SCORM compliance test suite
npm run test:scorm

# Validate specific SCORM package
npm run test:package -- path/to/package.zip

# Generate compliance report
npm run compliance:report
```

### Known Limitations

- **Browser Compatibility**: Requires modern browsers with ES6+ support
- **File Size Limits**: Large packages (>500MB) may impact performance
- **Network Features**: Some advanced networking features not implemented
- **Custom Extensions**: LMS-specific extensions beyond SCORM spec not supported

## Development

### Architecture

The application follows a modular architecture with clear separation of concerns:

```
src/
├── main/                   # Main Electron process
│   ├── services/scorm/     # SCORM engine implementation
│   │   ├── cam/           # Content Aggregation Model
│   │   ├── rte/           # Run-Time Environment  
│   │   └── sn/            # Sequencing and Navigation
│   └── services/          # System services
├── renderer/              # Renderer process
│   ├── components/        # UI components
│   └── services/          # Client-side services
└── shared/                # Shared utilities and types
    ├── constants/         # SCORM constants and error codes
    ├── types/             # TypeScript definitions
    └── utils/             # Utility functions
```

### Development Setup

See the [Development Setup Guide](dev_docs/guides/development-setup.md) for detailed instructions.

#### Quick Setup
```bash
# Install dependencies
npm install

# Start development mode
npm run dev

# Run tests
npm test

# Check code quality
npm run lint
npm run type-check
```

### API Documentation

Comprehensive API documentation is available:
- [SCORM API Reference](dev_docs/api/scorm-api.md)
- [Module Documentation](dev_docs/modules/)
- [Architecture Overview](dev_docs/architecture/overview.md)

### Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

#### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure all tests pass
5. Submit a pull request

#### Code Standards
- **File Size**: Maximum 200 lines per file
- **Test Coverage**: Minimum 90% coverage
- **Documentation**: JSDoc comments for all public APIs
- **TypeScript**: Full type coverage for AI tool support

## Testing

### Test Categories

```bash
# Unit tests - Individual module testing
npm run test:unit

# Integration tests - Component interaction
npm run test:integration  

# End-to-end tests - Complete workflow validation
npm run test:e2e

# SCORM compliance tests - Specification adherence
npm run test:scorm

# Performance tests - Load and stress testing
npm run test:performance
```

### Sample SCORM Packages

Test packages are included in the `references/` directory:
- `SequencingSimpleRemediation_SCORM20043rdEdition.zip` - Basic sequencing example
- `SL360_LMS_SCORM_2004.zip` - Articulate Storyline package

## Troubleshooting

### Common Issues

#### SCORM Package Won't Load
```bash
# Check package structure
npm run validate:package -- path/to/package.zip

# View detailed error logs
DEBUG=scorm-tester:* npm start
```

#### API Calls Failing
- Verify SCORM API object is available: `window.API_1484_11`
- Check session state (must Initialize before other calls)
- Review error codes in debug panel

#### Performance Issues
- Large packages: Enable streaming mode in settings
- Memory usage: Restart application periodically
- Debug mode: Disable when not needed

### Debug Mode

Enable comprehensive debugging:
```bash
# Environment variable
DEBUG=scorm-tester:* npm start

# Or in application settings
Settings > Debug > Enable Verbose Logging
```

### Support

- 📖 [Documentation](dev_docs/)
- 🐛 [Issue Tracker](https://github.com/your-org/scorm-tester/issues)
- 💬 [Discussions](https://github.com/your-org/scorm-tester/discussions)
- 📧 [Email Support](mailto:support@your-org.com)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [ADL (Advanced Distributed Learning)](https://adlnet.gov/) for SCORM specifications
- [Electron](https://electronjs.org/) for the desktop application framework
- [SCORM Cloud](https://cloud.scorm.com/) for inspiration and reference implementation
- The e-learning community for feedback and contributions

## Roadmap

### Upcoming Features
- [ ] SCORM 1.2 backward compatibility
- [ ] xAPI (Tin Can API) support
- [ ] Cloud-based package sharing
- [ ] Advanced analytics and reporting
- [ ] Mobile device testing simulation

### Version History
- **v2.0.0** (Planned) - Modular architecture refactor
- **v1.5.0** (Current) - Enhanced debugging tools
- **v1.0.0** - Initial SCORM 2004 4th Edition support

---

**Made with ❤️ for the e-learning community**