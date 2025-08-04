# Renderer Architecture Guide

## Overview

The SCORM Tester renderer has been completely refactored from a monolithic architecture to a modern, modular system. This guide provides comprehensive documentation for developers working with the new architecture.

## Architecture Principles

### 1. Event-Driven Architecture
- **Centralized Communication**: All components communicate through a central event bus
- **Loose Coupling**: Components don't directly reference each other
- **Scalability**: Easy to add new components without modifying existing ones
- **Debugging**: Comprehensive event logging and monitoring

### 2. Service-Oriented Design
- **Core Services**: Shared functionality extracted into reusable services
- **Clear Interfaces**: Well-defined APIs for service interaction
- **Dependency Injection**: Services injected into components as needed
- **Testability**: Services can be mocked and tested independently

### 3. Component-Based UI
- **Modular Components**: Self-contained UI components with clear responsibilities
- **Inheritance Hierarchy**: Base component provides common functionality
- **Lifecycle Management**: Standardized component lifecycle (render, destroy, etc.)
- **State Management**: Component-level state with global state integration

## Directory Structure

```
src/renderer/
├── app.js                          # Main application entry point (199 lines)
├── services/                       # Core services
│   ├── event-bus.js                # Event communication system (199 lines)
│   ├── ui-state.js                 # Application state management (199 lines)
│   └── scorm-client.js             # SCORM API client (199 lines)
├── components/                     # UI components
│   ├── base-component.js           # Abstract base component (199 lines)
│   └── scorm/                      # SCORM-specific components
│       ├── content-viewer.js       # Content display component (199 lines)
│       ├── navigation-controls.js  # Navigation interface (199 lines)
│       ├── progress-tracking.js    # Progress display (199 lines)
│       ├── debug-panel.js          # Debug and monitoring (199 lines)
│       └── course-outline.js       # Course structure display (199 lines)
└── types/                          # TypeScript definitions
    └── component-types.d.ts        # Component type definitions (199 lines)

src/shared/types/
└── scorm-types.d.ts                # SCORM type definitions (199 lines)

src/styles/                         # Modular CSS architecture
├── main.css                        # Main stylesheet entry point
├── base/                           # Foundation styles
│   ├── variables.css               # CSS custom properties (199 lines)
│   ├── reset.css                   # CSS reset and normalization
│   └── typography.css              # Typography system
├── components/                     # Component-specific styles
│   ├── buttons.css                 # Button system (199 lines)
│   ├── forms.css                   # Form controls (199 lines)
│   └── layout.css                  # Layout utilities (199 lines)
└── themes/                         # Theme system
    ├── default.css                 # Light theme (199 lines)
    └── dark.css                    # Dark theme (199 lines)

index.html                          # Application entry point (299 lines)
```

## Core Services

### Event Bus Service

**Purpose**: Centralized event communication system enabling loose coupling between components.

**Key Features**:
- Event priorities and once-only listeners
- Comprehensive logging and debugging
- Memory leak prevention with automatic cleanup
- Type-safe event handling

**Usage Example**:
```javascript
import { EventBus } from './services/event-bus.js';

const eventBus = new EventBus();

// Listen for events
eventBus.on('course:loaded', (data) => {
  console.log('Course loaded:', data.courseInfo);
});

// Emit events
eventBus.emit('course:loaded', { courseInfo: {...} });
```

**API Reference**:
- `on(eventName, listener, priority)` - Add event listener
- `once(eventName, listener, priority)` - Add one-time listener
- `off(eventName, listener)` - Remove listener
- `emit(eventName, data)` - Emit event
- `clear()` - Remove all listeners

### UI State Manager

**Purpose**: Persistent application state management with localStorage integration.

**Key Features**:
- Path-based state access (e.g., 'ui.theme', 'course.progress')
- Automatic persistence with configurable intervals
- State change history and rollback capabilities
- Type-safe state operations

**Usage Example**:
```javascript
import { UIStateManager } from './services/ui-state.js';

const uiState = new UIStateManager({
  persistKey: 'scorm-tester-state',
  autoSave: true,
  saveInterval: 5000
});

// Get/set state
const theme = uiState.get('ui.theme', 'default');
uiState.set('ui.theme', 'dark');

// Subscribe to changes
uiState.subscribe('ui.theme', (newTheme) => {
  document.body.className = `theme-${newTheme}`;
});
```

**API Reference**:
- `get(path, defaultValue)` - Get state value
- `set(path, value)` - Set state value
- `update(path, updater)` - Update with function
- `subscribe(path, callback)` - Listen for changes
- `save()` - Force save to storage

### SCORM Client Service

**Purpose**: Complete SCORM 2004 4th Edition API implementation with IPC integration.

**Key Features**:
- Full SCORM API compliance (Initialize, Terminate, GetValue, SetValue, etc.)
- Automatic retry logic and error handling
- Real-time API call monitoring and logging
- Integration with main process services

**Usage Example**:
```javascript
import { ScormClient } from './services/scorm-client.js';

const scormClient = new ScormClient({
  apiVersion: '2004',
  timeout: 30000,
  enableLogging: true
});

// Initialize SCORM session
await scormClient.initialize();

// Set/get values
await scormClient.setValue('cmi.completion_status', 'completed');
const status = await scormClient.getValue('cmi.completion_status');

// Terminate session
await scormClient.terminate();
```

**API Reference**:
- `initialize()` - Initialize SCORM session
- `terminate()` - Terminate SCORM session
- `getValue(element)` - Get data model value
- `setValue(element, value)` - Set data model value
- `commit()` - Commit data to LMS
- `getLastError()` - Get last error code

## Component System

### Base Component

**Purpose**: Abstract base class providing common functionality for all UI components.

**Key Features**:
- Standardized lifecycle management
- Event handling and DOM manipulation utilities
- Error handling and state management
- Accessibility support

**Usage Example**:
```javascript
import { BaseComponent } from './base-component.js';

class MyComponent extends BaseComponent {
  constructor(config) {
    super(config);
  }
  
  render() {
    this.element = this.createElement();
    this.bindEvents();
    this.show();
  }
  
  destroy() {
    this.unbindEvents();
    this.hide();
    if (this.element) {
      this.element.remove();
    }
  }
}
```

**Lifecycle Methods**:
- `render()` - Create and display component
- `destroy()` - Clean up and remove component
- `show()` - Make component visible
- `hide()` - Hide component
- `bindEvents()` - Attach event listeners
- `unbindEvents()` - Remove event listeners

### SCORM Components

#### Content Viewer
**Purpose**: Secure display of SCORM content in sandboxed iframe.

**Features**:
- Fullscreen support
- Loading states and error handling
- Content security and sandboxing
- Navigation integration

#### Navigation Controls
**Purpose**: LMS-style navigation interface for course progression.

**Features**:
- Previous/Next navigation
- Exit and menu controls
- Keyboard shortcuts
- Dynamic state management

#### Progress Tracking
**Purpose**: Real-time visualization of learning progress.

**Features**:
- Progress bars and percentages
- Score and completion status
- Time tracking
- Animated updates

#### Debug Panel
**Purpose**: Development and testing tools for SCORM debugging.

**Features**:
- Real-time API call monitoring
- Data model inspection
- Session information display
- Export capabilities

#### Course Outline
**Purpose**: Hierarchical display of course structure.

**Features**:
- Tree view with expand/collapse
- Progress indicators
- Item selection and navigation
- Accessibility support

## Styling System

### CSS Architecture

The styling system uses a modular approach with CSS custom properties for theming:

**Base Styles**:
- `variables.css` - CSS custom properties and design tokens
- `reset.css` - Modern CSS reset and normalization
- `typography.css` - Typography scale and font management

**Component Styles**:
- `buttons.css` - Complete button system with variants and states
- `forms.css` - Form controls, validation, and accessibility
- `layout.css` - Layout utilities, grid system, and responsive design

**Theme System**:
- `default.css` - Professional light theme
- `dark.css` - Dark theme optimized for low-light environments

### Theme Implementation

Themes use CSS custom properties for dynamic switching:

```css
:root {
  --primary-color: #3b82f6;
  --bg-color: #ffffff;
  --text-color: #1f2937;
}

.theme-dark {
  --primary-color: #60a5fa;
  --bg-color: #0f0f0f;
  --text-color: #f5f5f5;
}
```

### Responsive Design

The system uses a mobile-first approach with breakpoints:
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

## TypeScript Integration

### Type Definitions

Comprehensive TypeScript definitions provide full IDE support:

**SCORM Types** (`scorm-types.d.ts`):
- Complete SCORM 2004 4th Edition interfaces
- Data model and API definitions
- Manifest and sequencing types
- Validation and error types

**Component Types** (`component-types.d.ts`):
- Component configuration interfaces
- Service class definitions
- Event system types
- Utility type definitions

### Usage Example

```typescript
import { ScormClient, ScormDataModel } from '../types/scorm-types';
import { ComponentConfig } from '../types/component-types';

class MyComponent extends BaseComponent {
  private scormClient: ScormClient;
  
  constructor(config: ComponentConfig) {
    super(config);
  }
  
  async updateProgress(progress: number): Promise<void> {
    await this.scormClient.setValue('cmi.progress_measure', progress.toString());
  }
}
```

## Application Lifecycle

### Initialization Sequence

1. **Service Initialization**
   - Event Bus creation and configuration
   - UI State Manager setup with persistence
   - SCORM Client initialization

2. **Component Creation**
   - Base components instantiated with configuration
   - Event listeners registered with Event Bus
   - DOM elements created and styled

3. **Application Start**
   - Components rendered and made visible
   - Event handlers activated
   - Initial state restored from storage

### Event Flow

```
User Action → Component → Event Bus → Service → IPC → Main Process
                ↓
            UI Update ← Event Bus ← Service Response ← IPC Response
```

## Development Guidelines

### Adding New Components

1. **Extend Base Component**:
```javascript
import { BaseComponent } from '../base-component.js';

class NewComponent extends BaseComponent {
  constructor(config) {
    super(config);
    // Component-specific initialization
  }
  
  render() {
    // Create DOM elements
    // Bind event listeners
    // Show component
  }
  
  destroy() {
    // Clean up resources
    // Remove event listeners
    // Remove DOM elements
  }
}
```

2. **Register with Application**:
```javascript
// In app.js
const newComponent = new NewComponent({
  elementId: 'new-component',
  // Additional configuration
});
this.components.set('newComponent', newComponent);
```

3. **Add Styling**:
```css
/* In appropriate CSS file */
.new-component {
  /* Component styles */
}
```

### Event Handling Best Practices

1. **Use Descriptive Event Names**:
```javascript
// Good
eventBus.emit('course:loading-started', { courseId });
eventBus.emit('scorm:api-call-completed', { method, result });

// Avoid
eventBus.emit('update', data);
eventBus.emit('change', value);
```

2. **Include Relevant Data**:
```javascript
eventBus.emit('progress:updated', {
  percentage: 75,
  completionStatus: 'incomplete',
  scoreRaw: 85,
  timestamp: Date.now()
});
```

3. **Handle Errors Gracefully**:
```javascript
eventBus.on('error:scorm-api', (error) => {
  console.error('SCORM API Error:', error);
  this.showErrorNotification(error.message);
});
```

### State Management Patterns

1. **Use Path-Based Access**:
```javascript
// Good
uiState.set('course.current.progress', 0.75);
uiState.set('ui.sidebar.collapsed', true);

// Avoid
uiState.set('progress', 0.75);
uiState.set('collapsed', true);
```

2. **Subscribe to Relevant Changes**:
```javascript
uiState.subscribe('ui.theme', (theme) => {
  this.applyTheme(theme);
});

uiState.subscribe('course.current', (course) => {
  this.updateCourseDisplay(course);
});
```

## Testing Strategy

### Unit Testing

Each component and service should have comprehensive unit tests:

```javascript
// Example test structure
describe('ContentViewer', () => {
  let contentViewer;
  let mockEventBus;
  
  beforeEach(() => {
    mockEventBus = new MockEventBus();
    contentViewer = new ContentViewer({
      elementId: 'test-viewer',
      eventBus: mockEventBus
    });
  });
  
  it('should load content successfully', async () => {
    await contentViewer.loadContent('test-content.html');
    expect(contentViewer.isLoaded()).toBe(true);
  });
  
  it('should handle loading errors', async () => {
    await expect(contentViewer.loadContent('invalid-url'))
      .rejects.toThrow('Failed to load content');
  });
});
```

### Integration Testing

Test component interactions through the event system:

```javascript
describe('Component Integration', () => {
  it('should update progress when SCORM data changes', async () => {
    const scormClient = new ScormClient();
    const progressTracker = new ProgressTracking();
    
    await scormClient.setValue('cmi.progress_measure', '0.75');
    
    expect(progressTracker.getProgress()).toBe(75);
  });
});
```

## Performance Considerations

### Memory Management

1. **Proper Cleanup**:
```javascript
destroy() {
  // Remove event listeners
  this.eventBus.off('course:loaded', this.handleCourseLoaded);
  
  // Clear timers
  if (this.updateTimer) {
    clearInterval(this.updateTimer);
  }
  
  // Remove DOM elements
  if (this.element) {
    this.element.remove();
    this.element = null;
  }
}
```

2. **Event Listener Management**:
```javascript
// Use bound methods to enable proper cleanup
constructor() {
  this.handleClick = this.handleClick.bind(this);
}

bindEvents() {
  this.element.addEventListener('click', this.handleClick);
}

unbindEvents() {
  this.element.removeEventListener('click', this.handleClick);
}
```

### Optimization Techniques

1. **Debounce Frequent Updates**:
```javascript
updateProgress = debounce((progress) => {
  this.progressBar.style.width = `${progress}%`;
}, 100);
```

2. **Lazy Component Initialization**:
```javascript
getDebugPanel() {
  if (!this.debugPanel) {
    this.debugPanel = new DebugPanel(this.debugConfig);
  }
  return this.debugPanel;
}
```

## Troubleshooting

### Common Issues

1. **Component Not Rendering**:
   - Check if element ID exists in DOM
   - Verify component configuration
   - Check for JavaScript errors in console

2. **Events Not Firing**:
   - Verify event names match exactly
   - Check if listeners are properly registered
   - Ensure event bus is shared between components

3. **State Not Persisting**:
   - Check localStorage permissions
   - Verify state manager configuration
   - Check for JSON serialization errors

### Debug Tools

1. **Event Bus Logging**:
```javascript
const eventBus = new EventBus({
  enableLogging: true,
  logLevel: 'debug'
});
```

2. **State Change Monitoring**:
```javascript
uiState.subscribe('*', (path, value) => {
  console.log(`State changed: ${path} = ${value}`);
});
```

3. **Component State Inspection**:
```javascript
// Available in browser console
window.scormTesterApp.getComponent('contentViewer').getState();
```

## Migration from Legacy Code

### Step-by-Step Migration

1. **Identify Functionality**: Map existing features to new components
2. **Extract Services**: Move shared logic to service classes
3. **Create Components**: Implement new component classes
4. **Update Event Handling**: Replace direct calls with event system
5. **Test Integration**: Verify all functionality works correctly

### Compatibility Considerations

- Maintain existing IPC interfaces with main process
- Preserve SCORM API compatibility
- Keep existing keyboard shortcuts and accessibility features
- Maintain performance characteristics or improve them

This architecture provides a solid foundation for future development while maintaining full SCORM compliance and improving maintainability, performance, and user experience.