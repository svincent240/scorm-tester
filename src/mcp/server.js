"use strict";

/**
 * MCP stdio server (JSON-RPC 2.0 only) with tool registry.
 * Transport: JSON-RPC 2.0 over stdio (one message per line on stdout).
 */

const { successEnvelope, errorEnvelope } = require("./envelope");
const { mapError } = require("./errors");
const ToolRouter = require("./router");
const { scorm_echo } = require("./tools/echo");
const { scorm_session_open, scorm_session_status, scorm_session_events, scorm_session_close } = require("./tools/session");
const { scorm_lint_manifest, scorm_lint_api_usage, scorm_lint_parent_dom_access, scorm_validate_workspace, scorm_lint_sequencing, scorm_validate_compliance, scorm_report } = require("./tools/validate");
const { scorm_runtime_open, scorm_runtime_status, scorm_runtime_close, scorm_attempt_initialize, scorm_attempt_terminate, scorm_api_call, scorm_nav_get_state, scorm_nav_next, scorm_nav_previous, scorm_nav_choice, scorm_sn_init, scorm_sn_reset, scorm_capture_screenshot, scorm_test_api_integration, scorm_take_screenshot, scorm_test_navigation_flow, scorm_debug_api_calls, scorm_trace_sequencing, scorm_get_network_requests } = require("./tools/runtime");
const { scorm_dom_click, scorm_dom_fill, scorm_dom_query, scorm_dom_evaluate, scorm_dom_wait_for, scorm_keyboard_type } = require("./tools/dom");

const getLogger = require('../shared/utils/logger.js');
const fs = require('fs');
const path = require('path');

const logger = getLogger();

const router = new ToolRouter();

// Helpful metadata for MCP clients (tools/list)
const TOOL_META = new Map([
  ["scorm_echo", { description: "Echo utility for connectivity tests", inputSchema: { type: "object" } }],
  ["scorm_session_open", { description: "Open a session for a SCORM package", inputSchema: { type: "object", properties: { package_path: { type: "string" }, execution: { type: "object" }, timeout_ms: { type: "number" } }, required: ["package_path"] } }],
  ["scorm_session_status", { description: "Get session status", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_session_events", { description: "Read event stream for a session", inputSchema: { type: "object", properties: { session_id: { type: "string" }, since_event_id: { type: "number" }, max_events: { type: "number" } }, required: ["session_id"] } }],
  ["scorm_session_close", { description: "Close a session and finalize artifacts", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_lint_manifest", { description: "Parse and lint imsmanifest.xml", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_api_usage", { description: "Static check for Initialize/GetValue/SetValue/Terminate usage", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_parent_dom_access", { description: "Detect parent window DOM access violations in SCORM content", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_sequencing", { description: "Basic sequencing structure lint", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_validate_workspace", { description: "Aggregate validation of manifest and API usage", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_validate_compliance", { description: "Aggregate compliance score and report data", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_test_api_integration", { description: "Run content and capture API calls (Electron required)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, capture_api_calls: { type: "boolean" }, session_id: { type: "string" }, viewport: { type: "object" }, test_scenario: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_take_screenshot", { description: "Open content and capture a screenshot (Electron required)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, viewport: { type: "object" }, capture_options: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_capture_screenshot", { description: "Capture a screenshot from a persistent runtime", inputSchema: { type: "object", properties: { session_id: { type: "string" }, capture_options: { type: "object" } }, required: ["session_id"] } }],
  ["scorm_runtime_open", { description: "Open a persistent runtime for a session (Electron required)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, viewport: { type: "object" } }, required: ["session_id"] } }],
  ["scorm_runtime_status", { description: "Get persistent runtime status", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_runtime_close", { description: "Close persistent runtime", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_api_call", { description: "Call a SCORM RTE method on persistent runtime", inputSchema: { type: "object", properties: { session_id: { type: "string" }, method: { type: "string" }, args: { type: "array" } }, required: ["session_id", "method"] } }],
  ["scorm_nav_get_state", { description: "Get SN state via bridge", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_next", { description: "SN continue action", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_previous", { description: "SN previous action", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_choice", { description: "SN choice to a target activity", inputSchema: { type: "object", properties: { session_id: { type: "string" }, targetId: { type: "string" } }, required: ["session_id", "targetId"] } }],
  ["scorm_sn_init", { description: "Initialize SN engine via bridge", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_sn_reset", { description: "Reset SN engine via bridge", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_test_navigation_flow", { description: "Simulate simple navigation flow; optional per-step capture", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, navigation_sequence: { type: "array", items: { type: "string" } }, capture_each_step: { type: "boolean" }, viewport: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_debug_api_calls", { description: "Capture and summarize SCORM API calls (Electron required)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, filter_methods: { type: "array", items: { type: "string" } }, viewport: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_trace_sequencing", { description: "Trace SCORM SN structure and environment", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, trace_level: { type: "string", enum: ["basic", "detailed", "verbose"] }, viewport: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_report", { description: "Generate a compliance report (JSON or HTML)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, format: { type: "string", enum: ["json", "html"] } }, required: ["workspace_path"] } }],
  ["scorm_get_network_requests", { description: "Get network requests made by SCORM content for debugging", inputSchema: { type: "object", properties: { session_id: { type: "string" }, options: { type: "object", properties: { resource_types: { type: "array", items: { type: "string" } }, since_ts: { type: "number" }, max_count: { type: "number" } } } }, required: ["session_id"] } }],
  ["scorm_dom_click", { description: "Click a DOM element by selector in SCORM content", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, options: { type: "object", properties: { click_type: { type: "string", enum: ["single", "double", "right"] }, wait_for_selector: { type: "boolean" }, wait_timeout_ms: { type: "number" } } } }, required: ["session_id", "selector"] } }],
  ["scorm_dom_fill", { description: "Fill a form input element by selector (text, select, checkbox, radio)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, value: { type: ["string", "boolean", "number"] }, options: { type: "object", properties: { wait_for_selector: { type: "boolean" }, wait_timeout_ms: { type: "number" }, trigger_events: { type: "boolean" } } } }, required: ["session_id", "selector", "value"] } }],
  ["scorm_dom_query", { description: "Query DOM element state (text, attributes, visibility, styles, value)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, query_type: { type: "string", enum: ["all", "text", "attributes", "visibility", "styles", "value"] } }, required: ["session_id", "selector"] } }],
  ["scorm_dom_evaluate", { description: "Execute JavaScript in browser context and return serializable results", inputSchema: { type: "object", properties: { session_id: { type: "string" }, expression: { type: "string" }, return_by_value: { type: "boolean" } }, required: ["session_id", "expression"] } }],
  ["scorm_dom_wait_for", { description: "Wait for a DOM condition to be met (element visible, text appears, etc.)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, condition: { type: "object", properties: { selector: { type: "string" }, visible: { type: "boolean" }, text: { type: "string" }, attribute: { type: "string" }, attribute_value: { type: "string" }, expression: { type: "string" } } }, timeout_ms: { type: "number" } }, required: ["session_id", "condition"] } }],
  ["scorm_keyboard_type", { description: "Simulate keyboard typing in a focused element", inputSchema: { type: "object", properties: { session_id: { type: "string" }, text: { type: "string" }, options: { type: "object", properties: { selector: { type: "string" }, delay_ms: { type: "number" } } } }, required: ["session_id", "text"] } }],
  ["system_get_logs", { description: "Get recent log entries including browser console errors, warnings, and all application logs (NDJSON format)", inputSchema: { type: "object", properties: { tail: { type: "number" }, levels: { type: "array", items: { type: "string" } }, since_ts: { type: "number" }, component: { type: "string" } } } }],
  ["system_set_log_level", { description: "Set log level (debug|info|warn|error)", inputSchema: { type: "object", properties: { level: { type: "string", enum: ["debug", "info", "warn", "error"] } }, required: ["level"] } }],
]);

router.register("scorm_echo", scorm_echo);
router.register("scorm_session_open", scorm_session_open);
router.register("scorm_session_status", scorm_session_status);
router.register("scorm_session_events", scorm_session_events);
router.register("scorm_session_close", scorm_session_close);
router.register("scorm_lint_manifest", scorm_lint_manifest);
router.register("scorm_lint_api_usage", scorm_lint_api_usage);
router.register("scorm_lint_parent_dom_access", scorm_lint_parent_dom_access);
router.register("scorm_validate_workspace", scorm_validate_workspace);
router.register("scorm_lint_sequencing", scorm_lint_sequencing);
router.register("scorm_validate_compliance", scorm_validate_compliance);
router.register("scorm_runtime_open", scorm_runtime_open);
router.register("scorm_runtime_status", scorm_runtime_status);
router.register("scorm_runtime_close", scorm_runtime_close);
router.register("scorm_attempt_initialize", scorm_attempt_initialize);
router.register("scorm_attempt_terminate", scorm_attempt_terminate);
router.register("scorm_api_call", scorm_api_call);
router.register("scorm_test_api_integration", scorm_test_api_integration);
router.register("scorm_take_screenshot", scorm_take_screenshot);
router.register("scorm_capture_screenshot", scorm_capture_screenshot);
router.register("scorm_nav_get_state", scorm_nav_get_state);
router.register("scorm_nav_next", scorm_nav_next);
router.register("scorm_nav_previous", scorm_nav_previous);
router.register("scorm_nav_choice", scorm_nav_choice);
// System tools for logs and log level control
async function system_get_logs(params = {}) {
  const { tail = 200, levels = [], since_ts = 0, component = null } = params;
  const file = (logger && logger.ndjsonFile) ? logger.ndjsonFile : (logger && logger.logFile);
  if (!file) return { logs: [], note: 'No log file available' };

  const logDir = logger && logger.ndjsonFile ? path.dirname(logger.ndjsonFile) : null;
  const allLogFiles = logDir ? {
    ndjson: logger.ndjsonFile,
    errors: logger.errorsFile,
    human_readable: logger.logFile
  } : null;

  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(0, Math.min(tail, lines.length)));
    const out = [];
    for (const line of slice) {
      try {
        const obj = JSON.parse(line);
        if (since_ts && obj.ts && obj.ts < since_ts) continue;
        if (Array.isArray(levels) && levels.length && obj.level && !levels.includes(obj.level)) continue;
        if (component && obj.component !== component) {
          // allow pass if no component specified in entry
          continue;
        }
        out.push(obj);
      } catch (_) {
        // skip non-JSON lines
      }
    }
    return {
      logs: out,
      log_count: out.length,
      total_lines: lines.length,
      log_directory: logDir,
      log_files: allLogFiles,
      note: 'Includes browser console errors/warnings from SCORM content, application logs, and all MCP operations. Logs are flushed immediately to disk.',
      filters_applied: {
        tail,
        levels: levels.length > 0 ? levels : 'all',
        since_ts: since_ts || 'none',
        component: component || 'all'
      }
    };
  } catch (e) {
    return {
      logs: [],
      error: e.message,
      log_directory: logDir,
      log_files: allLogFiles
    };
  }
}

async function system_set_log_level(params = {}) {
  const { level } = params;
  if (!level) return { success: false, error: 'missing level' };
  try {
    if (logger && typeof logger.setLevel === 'function') {
      logger.setLevel(level);
      logger.info('Log level updated via MCP', { level });
      return { success: true, level };
    }
    return { success: false, error: 'logger not available' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

router.register('system_get_logs', system_get_logs);
router.register('system_set_log_level', system_set_log_level);

router.register("scorm_sn_init", scorm_sn_init);
router.register("scorm_sn_reset", scorm_sn_reset);
router.register("scorm_test_navigation_flow", scorm_test_navigation_flow);
router.register("scorm_debug_api_calls", scorm_debug_api_calls);
router.register("scorm_trace_sequencing", scorm_trace_sequencing);
router.register("scorm_report", scorm_report);
router.register("scorm_get_network_requests", scorm_get_network_requests);
router.register("scorm_dom_click", scorm_dom_click);
router.register("scorm_dom_fill", scorm_dom_fill);
router.register("scorm_dom_query", scorm_dom_query);
router.register("scorm_dom_evaluate", scorm_dom_evaluate);
router.register("scorm_dom_wait_for", scorm_dom_wait_for);
router.register("scorm_keyboard_type", scorm_keyboard_type);

function writeMessage(msg) {
  try {
    const line = JSON.stringify(msg);
    process.stdout.write(line + "\n");
  } catch (_) {
    // Best-effort only
  }
}

  // JSON-RPC helpers (for MCP-compatible clients like Kilo Code)
  function writeJSONRPCResult(id, result) {
    try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); } catch (_) {}
  }
  function writeJSONRPCError(id, code, message, data) {
    const err = { code, message };
    if (data !== undefined) err.data = data;
    try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: err }) + "\n"); } catch (_) {}
  }


async function handleRequest(req) {
  const startedAt = Date.now();

  // Detect JSON-RPC 2.0 shape
  const isJSONRPC = req && req.jsonrpc === "2.0";
  const id = req && ("id" in req) ? req.id : undefined;
  const method = req && req.method;
  const params = (req && req.params) || {};

  if (!method || typeof method !== "string") {
    // Enforce JSON-RPC 2.0 only
    return writeJSONRPCError(id ?? null, -32600, "Invalid Request");
  }

  // JSON-RPC compatibility for MCP clients (Kilo Code expects initialize/tools/*)
  if (isJSONRPC) {
    try {
      if (method === "initialize") {
        const result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "SCORM MCP", version: "1.0.0" },
          capabilities: { tools: { listChanged: true } }
        };
        return writeJSONRPCResult(id, result);
      }
      if (method === "tools/list") {
        const tools = [];
        try {
          for (const name of router.tools.keys()) {
            const meta = TOOL_META.get(name) || {};
            const tool = {
              name,
              description: meta.description || "SCORM MCP tool",
              inputSchema: meta.inputSchema || { type: "object" }
            };
            // Only include outputSchema if explicitly defined in TOOL_META
            // MCP requires structured content format when outputSchema is present
            if (meta.outputSchema) {
              tool.outputSchema = meta.outputSchema;
            }
            tools.push(tool);
          }
        } catch (_) {}
        return writeJSONRPCResult(id, { tools });
      }
      if (method === "tools/call") {
        const name = params && (params.name || params.toolName || params.tool);
        const args = (params && (params.arguments || params.args)) || {};
        if (!name || typeof name !== "string") {
          return writeJSONRPCError(id, -32602, "Invalid params: missing tool name");
        }
        try {
          logger?.info('MCP_TOOLS_CALL', { id, method: name, argsMeta: { keys: Object.keys(args||{}), hasArgs: !!args } });
          const toolResult = await router.dispatch(name, args);
          logger?.info('MCP_TOOLS_RESULT', { id, method: name, ok: true });

          // Convert tool result to MCP format: { content: [...], isError: false }
          // Tools return plain objects, so we wrap them in MCP's content array format
          const mcpResult = {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolResult, null, 2)
              }
            ],
            isError: false
          };

          return writeJSONRPCResult(id, mcpResult);
        } catch (err) {
          const mapped = mapError(err);
          logger?.error('MCP_TOOLS_ERROR', { id, method: name, error_code: mapped.error_code, message: mapped.message });

          // Return error in MCP format
          const mcpError = {
            content: [
              {
                type: "text",
                text: mapped.message || "Tool error"
              }
            ],
            isError: true
          };

          return writeJSONRPCResult(id, mcpError);
        }
      }

      // Fallback: allow direct method names over JSON-RPC too
      try {
        logger?.info('MCP_DIRECT_CALL', { id, method, hasParams: !!params });
        const data = await router.dispatch(method, params);
        logger?.info('MCP_DIRECT_RESULT', { id, method, ok: true });
        return writeJSONRPCResult(id, { data });
      } catch (err) {
        // Standard JSON-RPC method not found if unknown
        if (!router.has(method)) {
          logger?.warn('MCP_DIRECT_UNKNOWN', { id, method });
          return writeJSONRPCError(id, -32601, `Method not found: ${method}`);
        }
        const mapped = mapError(err);
        logger?.error('MCP_DIRECT_ERROR', { id, method, error_code: mapped.error_code, message: mapped.message });
        return writeJSONRPCError(id, -32000, mapped.message || "Server error", { error_code: mapped.error_code });
      }
    } catch (err) {
      return writeJSONRPCError(id, -32000, (err && err.message) || "Server error");
    }
  }

  // If we reach here, the request was not JSON-RPC 2.0; reject.
  return writeJSONRPCError(id ?? null, -32600, "Invalid Request: JSON-RPC 2.0 required");
}

function startServer() {
  // Read newline-delimited JSON from stdin
  let buffer = "";
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        handleRequest(msg);
      } catch (err) {
        // Strict JSON-RPC 2.0: parse errors use -32700 and null id
        writeJSONRPCError(null, -32700, "Parse error");
      }
    }
  });

  process.stdin.on("end", () => {
    try {
      // Ask Electron to quit first (closes windows), then exit the process
      let electron;
      try { electron = require('electron'); } catch (_) { electron = null; }
      if (electron && electron.app && !electron.app.isQuiting) {
        try { electron.app.quit(); } catch (_) {}
      }
    } finally {
      process.exit(0);
    }
  });

  // Ensure we exit cleanly on SIGINT/SIGTERM (tests/CI)
  const handleSignal = (sig) => {
    try {
      let electron;
      try { electron = require('electron'); } catch (_) { electron = null; }
      if (electron && electron.app) {
        try { electron.app.quit(); } catch (_) {}
      }
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, router };

