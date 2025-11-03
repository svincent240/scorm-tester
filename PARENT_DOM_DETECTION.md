# Parent DOM Access Detection

## Overview

This feature detects when SCORM course content attempts to access or modify the parent window's DOM, which violates SCORM best practices and can cause issues in LMS environments.

## Implementation

### Static Analysis Approach

Instead of runtime detection (which has reliability issues), we use **static code analysis** to scan course files for problematic patterns before the course runs.

### What Gets Detected

The system scans all HTML, JavaScript, and CSS files in the course for these patterns:

**JavaScript Violations (Errors):**
- `parent.document.getElementById`
- `parent.document.querySelector`
- `parent.document.getElementsBy*`
- `parent.document.body`
- `parent.document.head`
- `window.parent.document.*`
- `top.document.*`
- `$(parent.document)` (jQuery)

**CSS Violations (Warnings):**
- `position: fixed` - Can escape iframe boundaries and overlap parent window UI
- `position: sticky` - Can cause layout issues in iframes
- `height: 100vh` - Can cause iframe to expand beyond container and shift parent UI elements
- `width: 100vw` - Can cause iframe to expand beyond container and shift parent UI elements
- `min-height: 100vh` - Can cause iframe to expand beyond container and shift parent UI elements

**Not Flagged (Legitimate Patterns):**
- `html { height: 100% }` and `body { height: 100% }` - This is a standard flexbox layout pattern when properly constrained with `max-width`, `overflow`, etc.
- High z-index values (e.g., 1000+) - Z-index is scoped to the iframe's stacking context and cannot affect the parent window's UI

**Allowed (Not Flagged):**
- `parent.API` - Required for SCORM API discovery
- `parent.API_1484_11` - Required for SCORM 2004 API discovery
- `window.parent.API` - Alternative API discovery pattern

### Components

#### 1. MCP Tool: `scorm_lint_parent_dom_access`

**Location:** `src/mcp/tools/validate.js`

Scans course files and returns detailed violation information:

```javascript
{
  scanned_files: ["sco.html", "script.js"],
  violations: [
    {
      file: "script.js",
      line: 45,
      severity: "error",
      issue: "Accesses parent.document.getElementById",
      code_snippet: "var header = parent.document.getElementById('header');",
      fix_suggestion: "SCORM content should only access parent.API or parent.API_1484_11"
    }
  ]
}
```

#### 2. ContentValidator Integration

**Location:** `src/main/services/scorm/cam/content-validator.js`

The parent DOM linting runs automatically during course validation as part of the CAM (Content Aggregation Model) validation pipeline.

#### 3. GUI Error Display

**Location:** `src/renderer/components/notifications/error-list-panel.js`

Parent DOM violations are surfaced as **non-catastrophic errors** in the error panel with:
- ✅ File name and line number
- ✅ Code snippet showing the violation
- ✅ Fix suggestion
- ✅ Copy button to copy details
- ✅ Severity indicator (error/warning)

### Workflow

1. **Course Load** → User loads a SCORM course (ZIP or folder)
2. **CAM Processing** → Main process validates manifest and content
3. **Parent DOM Scan** → Static analysis scans all HTML/JS files
4. **Violation Detection** → Patterns are matched against violation rules
5. **Error Surfacing** → Violations are added to the error panel
6. **User Action** → Developer can see exact file/line and fix the course

### Testing

**Unit Tests:** `tests/unit/mcp/lint-parent-dom.test.js`

Tests cover:
- ✅ Detection of `parent.document` access
- ✅ Exclusion of legitimate `parent.API` access
- ✅ jQuery pattern detection
- ✅ Multiple violations in same file
- ✅ HTML file scanning
- ✅ Clean course (no violations)

**Test Course:** `references/test_courses/parent_dom_violation/`

A sample course with intentional violations for manual testing.

## Usage

### For Course Developers

1. Load your course in the SCORM Tester
2. Check the error badge (⚠️) in the header
3. Click to open the error panel
4. Review any "Parent DOM Violation" errors
5. Fix the violations in your course code
6. Reload the course to verify fixes

### For MCP/AI Agents

```javascript
// Validate a course workspace
const result = await scorm_lint_parent_dom_access({
  workspace_path: "./my-course"
});

if (result.violations.length > 0) {
  console.log("Found violations:");
  result.violations.forEach(v => {
    console.log(`${v.file}:${v.line} - ${v.issue}`);
    console.log(`Code: ${v.code_snippet}`);
    console.log(`Fix: ${v.fix_suggestion}`);
  });
}
```

## Why This Matters

### The Problem

SCORM courses run in iframes with `allow-same-origin` sandbox attribute, which means they CAN technically access `parent.document` and use CSS that escapes iframe boundaries. However:

1. **LMS Compatibility:** Different LMS systems have different DOM structures. Code that works in the tester might break in production.
2. **Maintenance:** Parent DOM manipulation creates tight coupling between course and LMS.
3. **Best Practices:** SCORM spec expects courses to be self-contained.
4. **CSS Positioning:** `position:fixed` in same-origin iframes is relative to the viewport, not the iframe, causing elements to escape and overlap parent UI.

### The Solution

This detection system helps course developers:
- ✅ Identify violations before deployment
- ✅ Get actionable fix suggestions
- ✅ Ensure LMS compatibility
- ✅ Follow SCORM best practices

## Technical Details

### Pattern Matching

Uses regex patterns with negative lookahead to exclude legitimate API access:

```javascript
/\bparent\.document\b(?!\.API)(?!\.API_1484_11)/g
```

This matches `parent.document` but NOT `parent.document.API` or `parent.document.API_1484_11`.

### Performance

- Scans HTML, JavaScript, and CSS files
- Runs during course load (one-time cost)
- Minimal impact on load time (< 100ms for typical courses)

### Limitations

1. **Static Analysis Only:** Cannot detect dynamically constructed code (e.g., `eval()`, `new Function()`)
2. **False Positives:** May flag commented-out code or string literals
3. **No Runtime Prevention:** Does not block violations at runtime, only reports them

## Future Enhancements

Potential improvements:
- [ ] Whitelist mechanism for known-safe patterns
- [ ] Severity levels (error vs warning)
- [ ] Auto-fix suggestions with code patches
- [ ] Integration with course authoring tools
- [ ] Runtime monitoring option (opt-in)

## Related Files

- `src/mcp/tools/validate.js` - Linting implementation
- `src/main/services/scorm/cam/content-validator.js` - CAM integration
- `src/renderer/services/course-loader.js` - Error surfacing
- `src/renderer/components/notifications/error-list-panel.js` - GUI display
- `tests/unit/mcp/lint-parent-dom.test.js` - Unit tests
- `references/test_courses/parent_dom_violation/` - Test course

