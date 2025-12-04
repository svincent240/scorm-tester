# SCORM Automation API Specification

## API Categories

### 1. Interaction Control

**List all interactions on current slide:**
```javascript
listInteractions()
// Returns: [{id: 'q1', type: 'multiple-choice', registeredAt: '2025-11-14T...'}]
```

**Set response:**
```javascript
setResponse(id, response)
// MCQ: setResponse('q1', 'b')
// True/False: setResponse('q2', true)
// Fill-in: setResponse('q3', {blank1: 'answer'})
// Drag-drop: setResponse('q4', {item1: 'zone2'})
// Numeric: setResponse('q5', 42.5)
```

**Get current response:**
```javascript
getResponse(id)
// Returns: Current learner response in format specific to interaction type
```

**Get correct answer:**
```javascript
getCorrectResponse(id)  // Requires exposeCorrectAnswers: true
// Returns: Correct answer in same format as responses
```

**Evaluate answer:**
```javascript
checkAnswer(id)
// Returns: {correct: true, score: 1, feedback: 'Correct!', ...}

checkSlideAnswers(slideId?)  // Check all interactions on slide
// Returns: [{interactionId: 'q1', type: 'multiple-choice', evaluation: {...}}]
```

### 2. Navigation

**Get course structure:**
```javascript
getCourseStructure()
// Returns: Array of slides from course-config.js
```

**Get current slide:**
```javascript
getCurrentSlide()
// Returns: 'intro' (slide ID or null)
```

**Navigate to slide:**
```javascript
goToSlide(slideId, context?)
// Example: goToSlide('lesson-1', {mode: 'review'})
```

### 3. Layout Analysis (AI-Optimized)

**Comprehensive page layout (single call):**
```javascript
getPageLayout()
// Returns: {
//   tree: {tag, testid, visualWeight, importance, children: [...], bounds},
//   viewport: {width, height},
//   patterns: [{type: 'horizontal-row', elements: ['btn1', 'btn2']}],
//   relationships: [{type: 'above', element: 'title', other: 'content', gap: 20}],
//   readableDescription: "Horizontal row at y:100px with 3 elements: nav-prev..."
// }
```

**Enhanced element details:**
```javascript
getElementDetails('my-button')
// Returns: {
//   testid, tag, id, classes,
//   boundingBox: {x, y, width, height, top, right, bottom, left},
//   computedStyle: {display, position, fontSize, color, ...},
//   visible: true,
//   inViewport: true,
//   semanticPosition: 'top left',  // NEW
//   visualWeight: 45,              // NEW
//   importance: 'secondary',       // NEW
//   isInteractive: true,           // NEW
//   textContent: '...'
// }
```

**Navigation flow analysis:**
```javascript
getLayoutFlow()
// Returns: {
//   readingOrder: [{order: 1, testid: 'title', position: {x, y}}],
//   keyboardFlow: [{tabOrder: 1, testid: 'btn1', canReceiveFocus: true}],
//   attentionFlow: [{testid: 'heading', prominence: 85}],
//   analysis: {
//     readingOrderMatchesTabOrder: false,
//     hasCustomTabOrder: true
//   }
// }
```

**Layout validation:**
```javascript
validatePageLayout()
// Returns: [{
//   severity: 'error',  // critical | error | warning | info
//   category: 'accessibility',
//   message: 'Low color contrast (3.2:1, requires 4.5:1)',
//   element: 'my-text',
//   details: {contrast: '3.2', required: '4.5', ...}
// }]

// Detects: off-screen content, overlaps, text overflow, contrast violations,
// touch targets < 44px, missing alt text, missing labels, focus indicators
```

### 4. Engagement Tracking

**Get engagement state:**
```javascript
getEngagementState()
// Returns: {
//   complete: false,
//   tracked: true,
//   requirements: [{type: 'viewAllTabs', met: false, progress: 0.66}]
// }
```

**Get progress:**
```javascript
getEngagementProgress()
// Returns: {
//   percentage: 75,
//   items: [{type: 'tabs', label: 'View all tabs', complete: false}]
// }
```

**Manual tracking (testing):**
```javascript
markTabViewed(tabId)
setScrollDepth(percentage)  // 0-100
resetEngagement()  // Reset current slide
```

### 5. Audio Control

**Get audio state:**
```javascript
getAudioState()
// Returns: {
//   currentSrc: 'audio/intro.mp3',
//   contextId: 'slide-01',
//   contextType: 'slide',  // 'slide' | 'modal' | 'tab'
//   position: 45.2,
//   duration: 120.5,
//   isPlaying: true,
//   isMuted: false,
//   volume: 1,
//   completionThreshold: 0.95,
//   isCompleted: false
// }
```

**Check audio availability:**
```javascript
hasAudio()
// Returns: true/false - whether audio is currently loaded
```

**Progress:**
```javascript
getAudioProgress()
// Returns: 75.5 (percentage 0-100)

isAudioCompletedForContext('intro')
// Returns: true/false - check completion for specific context (slideId, modal-xxx, etc.)
```

**Simulate completion (primary testing method):**
```javascript
simulateAudioComplete()
// Seeks to completion threshold AND triggers appropriate engagement tracking
// Automatically handles all three audio context types:
//   - 'slide' → triggers slideAudioComplete requirement
//   - 'modal' → triggers modalAudioComplete requirement
//   - 'standalone' → triggers audioComplete requirement
```

### 6. Observability

**Get trace log:**
```javascript
getAutomationTrace()
// Returns: [{timestamp: '2025-11-14T...', action: 'setResponse', ...}]
```

**Clear trace:**
```javascript
clearAutomationTrace()
```

**API version:**
```javascript
getVersion()
// Returns: {api: '1.6.0', phase: 6, features: [...]}
```

## Common Workflows

### Test an interaction
```javascript
// List interactions
const interactions = listInteractions();

// Set response
setResponse('q1', 'b');

// Check answer
const result = checkAnswer('q1');
console.log(result.correct ? 'Pass' : 'Fail');
```

### Validate page accessibility
```javascript
const issues = validatePageLayout();
const errors = issues.filter(i => i.severity === 'error');
console.log(`Found ${errors.length} accessibility errors`);
```

### Understand layout without screenshot
```javascript
const layout = getPageLayout();
console.log(layout.readableDescription);
// "Horizontal row at top with nav-prev, nav-next, nav-exit.
//  Large heading at middle center (primary importance).
//  Three cards in vertical stack below..."
```

### Test navigation flow
```javascript
const flow = getLayoutFlow();
if (!flow.analysis.readingOrderMatchesTabOrder) {
  console.warn('Tab order does not match visual reading order');
}
```

### Test audio gating

```javascript
// Check if slide has audio loaded
if (hasAudio()) {
  // Get audio state to understand context
  const state = getAudioState();
  console.log('Audio type:', state.contextType); // 'slide', 'modal', or 'standalone'
  
  // For testing, simulate completion (no need to wait for audio)
  simulateAudioComplete();
  
  // This triggers the appropriate engagement tracking:
  // - slide audio → slideAudioComplete requirement
  // - modal audio → modalAudioComplete requirement  
  // - standalone audio → audioComplete requirement
}

// Check audio completion for specific context
const completed = isAudioCompletedForContext('intro');
```

## data-testid Attributes

Elements with `data-testid` are automation-ready:

**Navigation:**
- `nav-prev`, `nav-next`, `nav-exit`
- `nav-menu-toggle`
- `nav-menu-item-{slideId}`
- `nav-section-{sectionId}`

**Interactions:**
- `{id}-check-answer`, `{id}-reset`
- `{id}-choice-{index}`
- `{id}-blank-{index}`
- `{id}-drag-item-{itemId}`
- `{id}-drop-zone-{zoneId}`

**Assessments:**
- `assessment-start`
- `assessment-nav-prev`, `assessment-nav-next`
- `assessment-submit`, `assessment-retake`
- `assessment-review-question-{index}`

## Error Handling

All methods throw errors on failure (no silent failures):

```javascript
try {
  setResponse('invalid-id', 'value');
} catch (error) {
  console.error('Automation error:', error.message);
}
```

## MCP Integration

For AI tools using Model Context Protocol:

```javascript
// Use scorm_automation_* tools, NOT DOM tools
await scorm_automation_list_interactions({ session_id });
await scorm_automation_set_response({ session_id, interaction_id, response });
await scorm_automation_check_answer({ session_id, interaction_id });

// Layout analysis
await scorm_dom_evaluate({ 
  session_id,
  expression: "window.SCORMAutomation.getPageLayout()" 
});
```