# Navigation Flow for Single SCO Courses

## Overview

This document describes the navigation flow and handling of `adl.nav.request` for single SCO (Sharable Content Object) courses in SCORM 2004 4th Edition. Single SCO courses present unique challenges for navigation since there are no "next" or "previous" activities to navigate to.

## SCORM Navigation Model

### Navigation Requests

SCORM 2004 defines several navigation requests that SCOs can set via `adl.nav.request`:

- `continue` - Move to the next activity in sequence
- `previous` - Move to the previous activity in sequence
- `choice` - Jump to a specific activity (requires target identifier)
- `exit` - Exit the current activity
- `exitAll` - Exit the entire course
- `suspendAll` - Suspend the current session for later resumption
- `abandon` - Abandon the current activity
- `abandonAll` - Abandon the entire course

### Navigation Request Processing

According to SCORM 2004 4th Edition specification, the LMS must process navigation requests after the SCO terminates. The flow is:

1. SCO sets `adl.nav.request` to desired navigation action
2. SCO calls `Terminate("")`
3. LMS processes the navigation request
4. LMS executes the appropriate action based on the request and current sequencing state

## Single SCO Course Behavior

### Navigation Availability

For single SCO courses, the navigation availability is typically:

- `continue` → `false` (no next activity)
- `previous` → `false` (no previous activity)
- `choice` → `false` (no other activities to choose from)
- `exit` → `true` (can exit current activity)
- `exitAll` → `true` (can exit the course)
- `suspendAll` → `true` (can suspend for later resumption)

### Navigation Request Processing Logic

When processing navigation requests for single SCO courses:

#### `continue` Request
- **Validation**: Check if `adl.nav.request_valid.continue` is `true`
- **Action**: Since there is no next activity, this request is ignored
- **Result**: No navigation occurs, sequencing ends gracefully
- **Logging**: Debug message indicating continue not available

#### `previous` Request
- **Validation**: Check if `adl.nav.request_valid.previous` is `true`
- **Action**: Since there is no previous activity, this request is ignored
- **Result**: No navigation occurs
- **Logging**: Debug message indicating previous not available

#### `exit` / `exitAll` Requests
- **Validation**: Always valid for single SCO courses
- **Action**: Terminate the sequencing session
- **Result**: Course/session ends
- **Logging**: Info message about exit processing

#### `suspendAll` Request
- **Validation**: Always valid
- **Action**: Preserve session state for resumption
- **Result**: Session suspended, can be resumed later
- **Logging**: Info message about suspend processing

## Implementation Details

### Code Flow

```javascript
// In ScormService.terminate()
async terminate(sessionId) {
  // ... existing termination logic ...

  // NEW: Process navigation request after termination
  await this.processNavigationRequestAfterTermination(sessionId);

  // ... rest of termination logic ...
}
```

### Navigation Request Processing

```javascript
async processNavigationRequest(sessionId, navRequest) {
  switch (navRequest) {
    case 'continue':
      // Check availability and handle gracefully
      if (!sequencingState.availableNavigation?.continue) {
        return { success: true, reason: 'Continue navigation not available' };
      }
      return await this.snService.processNavigation('continue');

    case 'exit':
    case 'exitAll':
      // Always valid for single SCO
      return this.snService.terminateSequencing();

    // ... other cases
  }
}
```

## Testing Considerations

### Test Scenarios

1. **SCO sets `continue` on single SCO course**
   - Expected: Navigation request ignored, no error
   - Verification: Check logs for "Continue navigation not available"

2. **SCO sets `exitAll` on single SCO course**
   - Expected: Sequencing terminates successfully
   - Verification: Check that terminateSequencing() is called

3. **SCO sets `suspendAll` on single SCO course**
   - Expected: Session state preserved
   - Verification: Check suspend data persistence

### Integration Testing

```javascript
test('should handle navigation requests on single SCO courses', async () => {
  // Set up single SCO course
  // Initialize SCO
  // Set navigation request
  // Terminate SCO
  // Verify appropriate action taken
});
```

## Error Handling

### Invalid Navigation Requests
- Log warning for invalid/unsupported requests
- Continue with termination process
- Don't fail the termination due to invalid navigation request

### Sequencing Service Unavailable
- Log error if SN service not available
- Continue with basic termination
- Don't fail due to navigation processing failure

## Compliance Notes

This implementation ensures SCORM 2004 4th Edition compliance by:

1. Processing `adl.nav.request` after SCO termination
2. Validating navigation requests against current sequencing state
3. Handling single SCO courses gracefully
4. Providing appropriate logging and error handling
5. Maintaining session state integrity

## Future Enhancements

- Add support for custom navigation request handlers
- Implement navigation request queuing for complex scenarios
- Add navigation analytics and reporting
- Support for custom LMS navigation extensions