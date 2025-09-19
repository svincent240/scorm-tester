# SCORM MCP – TODOs (Current state aligned; future work tracked here)

Purpose: Maintain fail-fast, no-fallbacks, no-silent-errors. Spec reflects current implementation only; forward-looking items live here.

## High Priority

1) Tests for fail-fast coverage
- Add/adjust unit tests to assert JSON-RPC errors for missing prerequisites and no in-band error payloads
- Cover: SN_BRIDGE_UNAVAILABLE, SN_NOT_INITIALIZED, NAV_UNSUPPORTED_ACTION, MANIFEST_LAUNCH_NOT_FOUND, INVALID_SCORM_METHOD, ELECTRON_REQUIRED, CAPTURE_FAILED, NAV_FLOW_ERROR, DEBUG_API_ERROR, TRACE_SEQUENCING_ERROR

2) Centralize error codes
- Introduce shared error code catalog in src/mcp/errors.js and replace string literals across tools

3) Events consistency and docs
- Ensure scorm_session_events emits explicit error events on failures
- Document event shapes in spec appendix; add tests for event emission and sequencing/navigation traces

## Planned Features (migrated from spec)

4) Real-time debug session (GUI-assisted)
- scorm_debug_session_live: start/status/events/stop; integrate with session tools and optional GUI

5) Advanced SN step-through and decision streaming
- Step-through SN evaluation with rule decisions and navigation outcomes surfaced via events

6) Broader event streaming
- Rich sequencing decisions, activity transitions, and API call timing into scorm_session_events

7) Content optimization helpers (deferred)
- scorm_optimize_content: performance/accessibility/debug-info passes (advisory only)
- scorm_inspect_data_model: snapshots and diffs for data model states (non-mutating)

8) Optional SN utilities
- scorm_sn_status: snapshot of SN engine state separate from nav_get_state

## Nice-to-have

9) Diagnostics metadata
- Add diagnostics.duration_ms and operation identifiers in success responses
- Add correlation_id to events for multi-step flows

10) Client configuration guidance
- Provide example JSON MCP client configs (stdio-only; stdout purity) and xvfb hints for CI

## Cross-check: Affected Areas
- src/mcp/tools/runtime.js
- src/mcp/tools/validate.js
- src/mcp/runtime-manager.js
- src/mcp/server.js
- src/mcp/session.js (events)
- tests/**/*
- src/mcp/errors.js (central error codes)

## Acceptance Criteria (summary)
- Spec matches implementation (no future language inside the spec)
- All failures surface as JSON-RPC errors with -32000 and data.error_code (no in-band failure fields)
- No navigation fallbacks; explicit SN lifecycle adheres to fail-fast
- Tests assert new behaviors and error codes

