# UI Controls Reference

This document provides a comprehensive reference of all user interface controls and their functions in the SCORM Tester application.

## Application Layout

### Main Application Structure
- **App Container** (`#app`): Main application layout container with header, sidebar, content, and footer
- **Header** (`#app-header`): Top navigation bar with branding and primary actions
- **Sidebar** (`#app-sidebar`): Left panel containing course outline and navigation
- **Main Content** (`.app-content`): Central area with content viewer and navigation controls
- **Footer** (`#app-footer`): Bottom status bar with progress indicators

## Header Controls

### Primary Actions
- **Load ZIP Button** (`#course-load-btn`): Opens file dialog to select and load SCORM ZIP packages
- **Load Folder Button** (`#course-folder-btn`): Opens directory dialog to select and load SCORM course folders

### Utility Controls
- **Theme Toggle** (`#theme-toggle`): Switches between light and dark themes
- **SCORM Inspector Toggle** (`#scorm-inspector-toggle`): Opens/closes the SCORM debugging inspector window
- **Sidebar Toggle** (`#sidebar-toggle`): Shows/hides the sidebar (mobile only)

### Hidden Elements
- **File Input** (`#file-input`): Hidden file input for handling drag & drop operations

## Welcome Screen

### Primary Actions
- **Welcome Load ZIP** (`.welcome-actions .btn--primary`): Primary call-to-action for loading ZIP files
- **Welcome Load Folder** (`#welcome-folder-btn`): Secondary action for loading course folders
- **Sample Course Button** (`#sample-course-btn`): Loads a demonstration SCORM course

### Information Display
- **Recent Courses** (`#recent-courses`): Container displaying recently accessed courses
- **Feature Cards** (`.feature`): Informational cards highlighting application capabilities

## Navigation Controls

### Mode Controls
- **Learner Mode Button**: Switches to standard learner experience mode
- **Testing Mode Button**: Switches to testing mode with enhanced debugging capabilities

### Course Navigation
- **Previous Activity Button**: Navigates to the previous SCO in the course sequence
- **Next Activity Button**: Navigates to the next SCO in the course sequence
- **Course Menu Button**: Toggles the visibility of the course outline sidebar

### Status Display
- **Navigation Title**: Shows the current course or system title
- **Navigation Status**: Displays current navigation state and course information
- **Progress Bar**: Visual representation of course completion progress
- **Navigation Context**: Shows current activity position and details

## Course Outline (Sidebar)

### Structure Controls
- **Expand All Button** (`.outline-btn--expand`): Expands all collapsible outline items
- **Collapse All Button** (`.outline-btn--collapse`): Collapses all expanded outline items

### Content Display
- **Outline Items** (`[data-item-id]`): Individual course activities and organizational items with visual hierarchy
- **Item Toggle Buttons** (`.outline-item__toggle`): Expand/collapse individual outline sections (arrow indicators)
- **Item Titles** (`.outline-item__title`): Clickable activity names for direct navigation with proper focus states
- **Item Icons** (`.outline-item__icon`): Type indicators (📄 for SCOs, 📁 for folders, 📎 for assets)
- **Current Item Highlighting**: Active course item shown with bold text and primary color background
- **SCORM-Driven Progress Indicators** (`.progress-indicator`): Real-time completion status based on SCORM data:
  - **Completed** (`.progress-indicator--completed`): Green checkmark (✓) for completed activities
  - **Passed** (`.progress-indicator--passed`): Green checkmark (✓) for passed assessments
  - **Failed** (`.progress-indicator--failed`): Red X (✗) for failed assessments  
  - **Incomplete** (`.progress-indicator--incomplete`): Orange circle (○) for started but unfinished activities
  - **Not Attempted** (`.progress-indicator--not-attempted`): Gray circle (○) for unstarted activities

### Navigation Behavior
- **Click Navigation**: Clicking activity titles triggers SCORM choice navigation requests
- **Keyboard Navigation**: Full keyboard accessibility with focus indicators
- **Visual Feedback**: Hover states and focus outlines for all interactive elements
- **Progress Updates**: Automatic status updates based on SCORM data changes (completion_status, success_status)

### Empty States
- **Empty State Display** (`.course-outline__empty`): Message shown when no course is loaded with action buttons

### Enhanced Visual Design
- **Clean Activity Tree**: Removed conflicting checkbox/bullet combinations for cleaner presentation
- **Hierarchical Indentation**: Proper visual nesting with consistent spacing for depth levels
- **Responsive Typography**: Text sizing and truncation handling for long activity names
- **Theme Integration**: Full support for light/dark themes with proper contrast ratios
- **Accessibility Features**: ARIA labels, screen reader support, and high contrast mode compatibility
- **Performance Optimization**: Efficient rendering with minimal re-draws on SCORM data updates

## Content Viewer

### Content Display
- **Content Frame** (`#content-frame`): iframe containing the actual SCORM course content
- **Welcome Screen** (`.content-viewer__welcome`): Initial screen shown before course loading

### State Displays
- **Loading Display** (`.content-viewer__loading`): Shows loading animations and progress
- **Error Display** (`.content-viewer__error`): Displays error messages with recovery options
- **No Content Display** (`.content-viewer__no-content`): Message for activities without content

### Controls
- **Fullscreen Button** (`.content-viewer__fullscreen-btn`): Toggles fullscreen mode for content
- **Retry Button** (`.error-retry-btn`): Attempts to reload failed content

## Progress & Status Display

### Footer Status Bar
- **Progress Bar** (`#footer-progress-fill`): Visual progress indicator showing completion percentage
- **Progress Percentage** (`#footer-progress-percentage`): Numerical progress display
- **Learning Status** (`#footer-status`): Current learning status (Not Started, In Progress, Completed)
- **Score Display** (`#footer-score`): Current assessment score
- **Time Display** (`#footer-time`): Session duration timer

### Progress Tracking Component
- **Progress Container**: Detailed progress information for specific activities
- **Status Indicators**: Color-coded status displays with contextual information
- **Score Tracking**: Assessment results and scoring information
- **Time Tracking**: Session and activity duration monitoring

## SCORM Inspector Window

### Inspector Controls
- **Clear History Button** (`#clear-history-btn`): Removes all recorded SCORM API calls
- **Refresh Button** (`#refresh-btn`): Updates the inspector with latest data

### Debug Information
- **API Timeline** (`#api-timeline`): Chronological list of all SCORM API function calls
- **Error List** (`#error-list`): Collection of SCORM errors and compliance issues
- **API Call Entries** (`.api-entry`): Individual API call records with parameters and results
- **Error Entries** (`.error-entry`): Detailed error information with severity levels

### Data Model Tracking
- **Data Model Container** (`#data-model`): Complete SCORM data model display with real-time updates
- **Data Filter Input** (`#data-filter`): Text input for filtering data points by name or value
- **Clear Filter Button** (`#clear-filter`): Removes active filter and shows all data points
- **Expand All Data** (`#expand-all-data`): Expands all data model categories
- **Collapse All Data** (`#collapse-all-data`): Collapses all data model categories
- **Export Data Button** (`#export-data`): Downloads complete data model as JSON file

### Data Model Categories
- **Data Categories** (`.data-category`): Collapsible sections grouping related SCORM data
- **Category Headers** (`.data-category-header`): Clickable headers with icons and item counts
- **Category Content** (`.data-category-content`): Container for data items within each category
- **Data Items** (`.data-item`): Individual SCORM data model elements with name, value, and type
- **Item Names** (`.data-item-name`): SCORM data model element names (e.g., cmi.completion_status)
- **Item Values** (`.data-item-value`): Current values with type-specific color coding
- **Item Types** (`.data-item-type`): Data type indicators (string, number, boolean, etc.)
- **Change Indicators** (`.data-item-changed`): Visual highlights for recently updated values
- **Filter Matches** (`.filtered-match`): Highlighted items matching current filter

## System UI Elements

### Loading & Feedback
- **Loading Overlay** (`#loading-overlay`): Full-screen loading indicator for system operations
- **Loading Spinner** (`.loading-spinner`): Animated loading indicator
- **Loading Message** (`#loading-message`): Descriptive text for current loading operation
- **Notifications Container** (`#notifications`): System-wide notification display area

## Interactive States

### Button States
- **Default**: Normal interactive state
- **Hover**: Enhanced visual feedback on mouse over
- **Active**: Visual feedback during click/press
- **Disabled**: Non-interactive state for unavailable actions
- **Loading**: State during asynchronous operations

### Content States
- **Hidden**: Element not visible to user
- **Visible**: Element displayed and interactive
- **Expanded**: Collapsible content in open state
- **Collapsed**: Collapsible content in closed state
- **Selected**: Currently active or chosen item

### Data Model States
- **Real-time Updated**: Data automatically refreshes as SCORM content changes
- **Filtered**: Content filtered based on search criteria
- **Categorized**: Data organized into logical groupings
- **Type-coded**: Values color-coded by data type (string, number, boolean, null)
- **Change-highlighted**: Recently modified values visually emphasized
- **Exportable**: Current state can be downloaded as structured data

### Theme States
- **Light Theme**: Default light color scheme
- **Dark Theme**: Alternative dark color scheme
- **System Theme**: Automatically matches operating system preference

## Keyboard Navigation

### Supported Shortcuts
- **Ctrl+Shift+S**: Toggle SCORM Inspector window
- **F11**: Toggle fullscreen mode for content viewer
- **Escape**: Exit fullscreen mode
- **Tab/Shift+Tab**: Navigate between focusable elements

### Accessibility Features
- **Focus Indicators**: Visual outline for keyboard navigation
- **Screen Reader Support**: ARIA labels and semantic markup
- **High Contrast Mode**: Enhanced visibility for accessibility needs
- **Reduced Motion**: Respects user motion preferences

## Responsive Behavior

### Mobile Adaptations (≤ 768px)
- Sidebar converts to overlay navigation
- Touch-optimized button sizes
- Simplified navigation layouts
- Stacked information displays

### Tablet Adaptations (769px - 1024px)
- Adjusted sidebar width
- Optimized spacing and margins
- Modified grid layouts for better content flow

### Desktop Experience (≥ 1200px)
- Full feature set availability
- Enhanced spacing and visual hierarchy
- Optimal content width utilization

## Error Handling UI

### Error States
- **Content Load Errors**: Display retry options and error details
- **Network Errors**: Show connection status and recovery actions
- **SCORM Compliance Errors**: Highlight specification violations
- **System Errors**: Provide fallback functionality and guidance

### Recovery Actions
- **Retry Mechanisms**: Allow users to attempt failed operations again
- **Fallback Modes**: Provide alternative functionality when features fail
- **Error Reporting**: Enable users to report issues for support

## SCORM Data Model Categories

The SCORM Inspector organizes all data model elements into nine logical categories for improved navigation and understanding:

### Core Tracking (🎯)
Essential completion and success tracking elements:
- `cmi.completion_status` - Learner completion state
- `cmi.success_status` - Mastery achievement status  
- `cmi.credit` - Credit mode for the attempt

### Score & Assessment (📊)
Scoring and assessment-related data:
- `cmi.score.scaled` - Normalized score (0.0 to 1.0)
- `cmi.score.raw` - Raw score value
- `cmi.score.min` - Minimum possible score
- `cmi.score.max` - Maximum possible score

### Time Tracking (⏱️)
Session and cumulative time data:
- `cmi.session_time` - Current session duration
- `cmi.total_time` - Cumulative time across sessions
- `cmi.time_limit_action` - Behavior when time limit exceeded

### Progress & Location (📍)
Progress measurement and navigation data:
- `cmi.progress_measure` - Completion progress (0.0 to 1.0)
- `cmi.location` - Bookmark/resume location
- `cmi.entry` - Entry condition (ab-initio, resume)
- `cmi.exit` - Exit condition (timeout, suspend, logout, normal)

### Learner Information (👤)
Learner identity and preference data:
- `cmi.learner_id` - Unique learner identifier
- `cmi.learner_name` - Learner's display name
- `cmi.learner_preference.*` - Audio, language, delivery preferences

### Objectives (🎓)
Learning objectives and their states:
- `cmi.objectives._count` - Number of objectives
- `cmi.objectives.{n}.id` - Objective identifier
- `cmi.objectives.{n}.score.*` - Objective-specific scores
- `cmi.objectives.{n}.success_status` - Objective mastery
- `cmi.objectives.{n}.completion_status` - Objective completion

### Interactions (💬)
Learner interaction responses and data:
- `cmi.interactions._count` - Number of interactions
- `cmi.interactions.{n}.id` - Interaction identifier
- `cmi.interactions.{n}.type` - Interaction type
- `cmi.interactions.{n}.learner_response` - Learner's response
- `cmi.interactions.{n}.result` - Interaction result
- `cmi.interactions.{n}.correct_responses.*` - Expected answers

### Comments (📝)
Bidirectional comments between learner and LMS:
- `cmi.comments_from_learner.*` - Learner annotations
- `cmi.comments_from_lms.*` - LMS feedback and notes

### System Data (⚙️)
System-level and session management data:
- `cmi.mode` - Delivery mode (browse, normal, review)
- `cmi.suspend_data` - SCO-specific persistence data
- Additional runtime and system elements

## Data Model Features

### Real-time Synchronization
- **Live Updates**: Data refreshes automatically as SCORM content executes
- **Change Detection**: Visual indicators highlight recently modified values
- **History Tracking**: Previous values stored for comparison and analysis

### Advanced Filtering
- **Text Search**: Filter by data element names or current values
- **Instant Results**: Real-time filtering as you type
- **Match Highlighting**: Visual emphasis on search matches
- **Filter Statistics**: Count of visible vs total elements

### Professional Display
- **Type-coded Values**: Color coding based on data type (string, number, boolean, null)
- **Organized Categories**: Logical grouping of related data elements  
- **Collapsible Sections**: Expand/collapse categories for focused viewing
- **Export Capability**: Download complete data snapshots for analysis

### Interactive Controls
- **Category Management**: Expand/collapse individual or all categories
- **Persistent State**: Category visibility preferences saved locally
- **Search and Filter**: Advanced text-based filtering with clear controls
- **Data Export**: JSON export with metadata and change history

## Enhanced SCORM Inspector Features

### Advanced Inspector Controls
- **Refresh Activity Tree** (`#refresh-activity-tree`): Updates activity tree display with latest course structure from SN service
- **Expand All Activities** (`#expand-all-activities`): Expands all activity tree nodes to show detailed information
- **Collapse All Activities** (`#collapse-all-activities`): Collapses all activity tree nodes for overview
- **Refresh Navigation** (`#refresh-navigation`): Updates navigation analysis with current sequencing state
- **Expand All Navigation** (`#expand-all-nav`): Expands all navigation request details and analysis
- **Collapse All Navigation** (`#collapse-all-nav`): Collapses all navigation request details
- **Refresh Objectives** (`#refresh-objectives`): Updates global objectives display from activity tree
- **Export Objectives** (`#export-objectives`): Downloads global objectives as JSON file with metadata
- **Refresh SSP** (`#refresh-ssp`): Updates SSP buckets display from active RTE instances
- **Export SSP Data** (`#export-ssp`): Downloads SSP bucket data as JSON file with size information
- **Clear Enhanced Log** (`#clear-enhanced-log`): Removes all enhanced log entries from memory
- **Export Enhanced Log** (`#export-enhanced-log`): Downloads enhanced log as JSON file with filtering info
- **Expand All Log** (`#expand-all-log`): Expands all log entry details for comprehensive view

### Advanced Inspector Displays
- **Activity Tree** (`#activity-tree`): Real-time hierarchical course structure showing:
  - Activity hierarchy with nested organizational items and SCOs
  - Completion and success status indicators with color coding
  - Activity-specific details including attempt counts and progress measures
  - Sequencing definition information (choice, flow, forward-only settings)
  - Activity objectives with satisfaction status
  - Expand/collapse functionality for focused inspection
- **Navigation Analysis** (`#navigation-analysis`): Live navigation request analysis showing:
  - Available navigation requests (Start, Resume All, Exit, etc.)
  - Request status (enabled/disabled) with visual indicators
  - Target activity identification for choice-based navigation
  - Exception handling information and diagnostic details
  - Success prediction analysis (will always/never succeed)
- **Global Objectives** (`#global-objectives`): Shared learning objectives tracking:
  - Objective identifiers with satisfaction status
  - Score and progress measure tracking
  - Real-time updates from SCORM data model changes
  - Export functionality for detailed analysis
- **SSP Buckets** (`#ssp-buckets`): Shared State Persistence data management:
  - Session-specific SSP bucket identification
  - Data size monitoring with byte-level accuracy
  - Persistence scope information (session, learner, course)
  - Content preview with truncated data display
- **Enhanced Log Viewer** (`#enhanced-log`): Comprehensive debugging log with:
  - Category filtering (Control, Runtime, Sequencing, P-Code)
  - Timestamp-based chronological ordering
  - Expandable entry details with structured data
  - Real-time log streaming from SCORM engine components
  - Export functionality with filter state preservation

### Integration and Data Flow
- **Real-time Data Synchronization**: All enhanced inspector sections automatically update when SCORM engine state changes
- **IPC Communication**: Secure communication with main process services for live data retrieval:
  - `getActivityTree()` - Retrieves serialized activity tree from SN service
  - `getNavigationRequests()` - Gets current navigation analysis from sequencing engine
  - `getGlobalObjectives()` - Extracts global objectives from activity tree
  - `getSSPBuckets()` - Collects SSP data from active RTE instances
- **Error Handling**: Graceful fallbacks when SCORM services are unavailable or data is not loaded
- **Performance Optimization**: Efficient data serialization and caching for responsive UI updates
- **State Persistence**: UI state (expanded/collapsed sections) saved locally for consistent user experience

This reference provides the complete inventory of user interface controls and their functions within the SCORM Tester application, organized by functional area and interaction patterns.