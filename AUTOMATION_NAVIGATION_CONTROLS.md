# Automation Navigation Controls

## Overview

The **AutomationNavigationControls** component provides slide-based navigation for SCORM courses that expose the `window.SCORMAutomation` API. This is **distinct and separate** from the existing SCORM sequencing navigation controls (`NavigationControls`) which handle multi-SCO courses.

## Features

- **Automatic Detection**: Controls appear automatically when automation API is available
- **Slide Selector**: Dropdown menu to jump to any slide in the course
- **Previous/Next Buttons**: Navigate sequentially through slides
- **Position Indicator**: Shows current slide number and total slides
- **Visual Distinction**: Purple gradient design differentiates from SCORM navigation
- **Keyboard Shortcuts**: Alt+Left/Right arrow keys for navigation
- **Version Display**: Shows automation API version when available

## Architecture

### Component Location
- **File**: `src/renderer/components/scorm/automation-navigation-controls.js`
- **Styles**: `src/styles/components/automation-navigation-controls.css`
- **Mount Point**: `#automation-navigation-controls` in header navigation area

### State Management
- Listens to `UIState.automation` slice for state updates
- Responds to automation probe results from `AutomationBridgeService`
- Auto-hides when automation API is not available

### IPC Flow
1. AppManager triggers `automation:probe` on course load/SCORM init
2. AutomationBridgeService queries content frame for `window.SCORMAutomation`
3. Service updates UIState automation slice with structure/availability
4. Component subscribes to UIState and renders accordingly
5. User navigation triggers `ipcClient.automationNavigate()`
6. AutomationBridgeService executes navigation in content frame
7. State broadcast updates component UI

## Usage

### For Developers

The component is automatically initialized by AppManager:

```javascript
// In app-manager.js component initialization
{ 
  name: 'automationNavigationControls', 
  class: AutomationNavigationControls, 
  elementId: 'automation-navigation-controls', 
  required: false 
}
```

### For Course Authors

To support automation navigation, your SCORM course must expose:

```javascript
window.SCORMAutomation = {
  version: '1.0.0',
  
  getCourseStructure: function() {
    return [
      { id: 'slide-1', title: 'Introduction' },
      { id: 'slide-2', title: 'Overview' },
      // ... more slides
    ];
  },
  
  getCurrentSlide: function() {
    return 'slide-1'; // Current slide ID
  },
  
  goToSlide: function(slideId, context) {
    // Navigate to specified slide
    // Return true on success, false on failure
    return true;
  }
};
```

### Supported Structure Formats

The component supports multiple structure formats:

#### Simple Array
```javascript
[
  { id: 'slide-1', title: 'Introduction' },
  { id: 'slide-2', title: 'Content' }
]
```

#### Object with Slides Property
```javascript
{
  slides: [
    { id: 'slide-1', title: 'Introduction' },
    { id: 'slide-2', title: 'Content' }
  ]
}
```

#### Nested Sections
```javascript
{
  sections: [
    {
      id: 'section-1',
      name: 'Getting Started',
      slides: [
        { id: 'slide-1-1', title: 'Welcome' },
        { id: 'slide-1-2', title: 'Setup' }
      ]
    }
  ]
}
```

## Visual Design

The automation controls use a **purple gradient** design to visually distinguish them from the blue SCORM sequencing controls:

- **Background**: Linear gradient from #667eea to #764ba2
- **Location**: Header navigation area, right after SCORM navigation controls
- **Visibility**: Auto-hides when not applicable
- **Responsive**: Stacks on mobile, adapts layout for smaller screens

## Keyboard Shortcuts

- `Alt + ←` (Left Arrow): Navigate to previous slide
- `Alt + →` (Right Arrow): Navigate to next slide

## Integration with SCORM Sequencing

The automation controls work **alongside** (not instead of) SCORM sequencing:

1. **Multi-SCO Courses**: SCORM navigation controls handle SCO-to-SCO navigation
2. **Single-SCO with Automation**: Automation controls handle slide-to-slide navigation
3. **Both Present**: Both control sets can be visible simultaneously
4. **Independent State**: Each system maintains separate navigation state

## Error Handling

- Navigation failures show temporary error message
- Unavailable API gracefully hides controls
- Structure parsing errors log to console without crashing
- State updates are atomic and fail-safe

## Testing

To test the automation controls:

1. Load a course with `window.SCORMAutomation` API
2. Verify controls appear in header after course loads
3. Test dropdown selection changes content
4. Test previous/next buttons navigate correctly
5. Verify position indicator updates
6. Test keyboard shortcuts (Alt+Arrow keys)
7. Verify controls hide when course without API loads

## Future Enhancements

Potential future additions:

- Slide thumbnails in dropdown
- Search/filter slides by title
- Bookmark/favorite slides
- Slide completion status indicators
- Animation/transition configuration
- Touch gesture support for mobile
