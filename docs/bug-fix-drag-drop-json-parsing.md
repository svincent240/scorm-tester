# Bug Fix: Drag-Drop Interaction JSON Parsing

## Issue Description

The `scorm_automation_set_response` MCP tool was failing for drag-drop interactions when MCP clients sent JSON objects as stringified values. While fill-in and numeric interactions worked correctly, drag-drop interactions have stricter type checking that requires actual JavaScript objects.

**Error Example:**

```text
Invalid response format for interaction 'system-architecture-dd' (type: drag-drop).
Expected: object with {itemId: zoneId} pairs (e.g., {"item1": "zone-a", "item2": "zone-b"}).
Got: string ("{\n  \"user-interface\": \"presentation\", ...}")
```

**Successful Interactions:**

- Fill-in: Worked because it accepts string responses
- Numeric: Worked because validation accepts both numbers and strings
- Choice: Worked for string responses

**Failed Interaction:**

- Drag-drop: Failed because it requires actual object type with strict validation

## Root Cause

MCP clients (like Kilo Code or other JSON-RPC clients) were serializing complex JSON objects as strings when sending them over the JSON-RPC protocol. By the time the response parameter reached our validation code, it was already a string like:

```javascript
response = '{"user-interface": "presentation", "business-logic": "application"}'
```

Instead of:

```javascript
response = {"user-interface": "presentation", "business-logic": "application"}
```

This is a common issue with JSON-RPC protocols where nested JSON structures get double-serialized.

## Solution

Added automatic JSON parsing for stringified objects and arrays before validation:

```javascript
// Handle stringified JSON objects from MCP clients
if (typeof response === 'string' && (response.trim().startsWith('{') || response.trim().startsWith('['))) {
  try {
    const parsed = JSON.parse(response);
    logger.debug('Parsed stringified JSON response', {
      session_id,
      id,
      originalType: 'string',
      parsedType: Array.isArray(parsed) ? 'array' : typeof parsed
    });
    response = parsed;
  } catch (parseErr) {
    // If parsing fails, it might be a legitimate string response (e.g., for fill-in)
    // Continue with the original string value
  }
}
```

## How This Fixes The Issue

1. **Automatic Detection**: Checks if response is a string that looks like JSON (starts with `{` or `[`)
2. **Safe Parsing**: Attempts to parse the JSON, but gracefully handles parse errors
3. **Type Preservation**: Converts stringified objects back to actual JavaScript objects
4. **Backward Compatible**: Fill-in responses that happen to contain `{` characters remain as strings if JSON.parse fails
5. **Logging**: Debug logs help track when parsing occurs for troubleshooting

## Enhanced Drag-Drop Support

Also added comprehensive drag-drop validation and error messages:

1. **Validation**: Added `drag-drop` case to `validateResponseFormat()`
   - Checks that response is an object (not array, not null)
   - Validates all zone IDs are strings

2. **Expected Format Documentation**: Added to `getExpectedResponseFormat()`
   - `'drag-drop': 'object with {itemId: zoneId} pairs (e.g., {"item1": "zone-a", "item2": "zone-b"})'`

3. **Enhanced Error Messages**: Added helpful troubleshooting for drag-drop failures
   - Shows the exact response format provided
   - Lists common issues (case sensitivity, missing items, wrapper objects)
   - Suggests using `scorm_automation_list_interactions` and `scorm_automation_get_correct_response`

## Test Coverage

Added comprehensive tests in `tests/unit/mcp/tools/automation.test.js`:

### JSON Parsing Tests (NEW)

1. **Stringified JSON Objects** (NEW)
   - Verifies objects sent as strings are properly parsed
   - Confirms parsed objects pass validation

2. **Stringified JSON Arrays** (NEW)
   - Tests arrays sent as strings for multi-select choice interactions
   - Validates proper array parsing

3. **Malformed JSON Handling** (NEW)
   - Ensures malformed JSON is treated as regular string
   - Prevents crashes from invalid JSON

4. **Ambiguous String Responses** (NEW)
   - Tests strings that look like JSON but are legitimate answers
   - Ensures fill-in responses like `{"this is my answer"}` work correctly

### Drag-Drop Validation Tests (NEW)

5. **Object Format Validation** (NEW)
   - Validates drag-drop requires object type
   - Rejects arrays, strings, null

6. **Non-String Zone ID Detection** (NEW)
   - Ensures all zone IDs are strings
   - Provides clear error for numeric or other types

7. **Valid Drag-Drop Response** (NEW)
   - Confirms properly formatted drag-drop responses work
   - Tests real-world example with multiple items

## Test Results

All 54 tests pass:
- ✅ Parameter validation (4 tests)
- ✅ Runtime status validation (1 test)
- ✅ API availability checking (3 tests)
- ✅ Core interaction tools (20 tests, including 4 NEW JSON parsing + 3 NEW drag-drop)
- ✅ Navigation tools (3 tests)
- ✅ Advanced introspection tools (4 tests)
- ✅ Debugging & tracing tools (2 tests)
- ✅ Error handling (2 tests)
- ✅ Response format validation error messages (15 tests, including 3 NEW drag-drop)

## Files Modified

1. **src/mcp/tools/automation.js**
   - Lines 436-467: Added JSON parsing before validation
   - Lines 83-92: Added drag-drop to expected format descriptions
   - Lines 287-319: Added drag-drop validation case
   - Lines 542-552: Added enhanced drag-drop error messages

2. **tests/unit/mcp/tools/automation.test.js**
   - Added 4 new JSON parsing tests
   - Added 3 new drag-drop validation tests

## Usage Example

Before (fails):
```javascript
// MCP client sends stringified JSON
await scorm_automation_set_response({
  session_id: 'test',
  id: 'system-architecture-dd',
  response: '{"user-interface": "presentation", "business-logic": "application"}'
  // Error: Got string, expected object
});
```

After (works):
```javascript
// Same call now automatically parses the JSON
await scorm_automation_set_response({
  session_id: 'test',
  id: 'system-architecture-dd',
  response: '{"user-interface": "presentation", "business-logic": "application"}'
  // ✅ Automatically parsed to object
});

// Or send as actual object (also works)
await scorm_automation_set_response({
  session_id: 'test',
  id: 'system-architecture-dd',
  response: {"user-interface": "presentation", "business-logic": "application"}
  // ✅ Already an object, no parsing needed
});
```

## Backward Compatibility

This fix is **fully backward compatible**:

- Actual objects continue to work without modification
- Stringified objects are now automatically parsed
- String responses for fill-in/text interactions remain unchanged
- Malformed JSON is safely handled without crashes
- All existing validation logic remains intact
- Error messages are more helpful

## Performance Impact

Minimal:
- JSON.parse only called for strings starting with `{` or `[`
- Parse errors are caught and handled gracefully
- Debug logging helps track parsing operations
- No impact on non-JSON string responses

## Related Issues

This fix also improves:
- Multi-select choice interactions sent as stringified arrays
- Matching interactions sent as stringified arrays of objects
- Any future interaction types that require complex object structures

## Related Documentation

- See `spec.md` Section 7.2 for Template Automation API architecture
- See `spec.md` Section 7.3 for complete list of MCP tools
- See previous fix: `bug-fix-automation-set-response-json-deserialization.md`
