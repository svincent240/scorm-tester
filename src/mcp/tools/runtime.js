"use strict";

const path = require("path");
const fs = require("fs");
const ManifestParser = require("../../main/services/scorm/cam/manifest-parser");
const sessions = require("../session");
const { RuntimeManager, resolveEntryPathFromManifest } = require("../runtime-manager");
const getLogger = require('../../shared/utils/logger.js');
const { scorm_dom_find_interactive_elements } = require('./dom');
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }

// Initialize logger
const logger = getLogger(process.env.SCORM_TESTER_LOG_DIR);

// Atomic counter for IPC message IDs to avoid collisions with concurrent calls
let _ipcMessageIdCounter = 0;

function ensureManifestPath(workspacePath) {
  const manifestPath = path.join(path.resolve(workspacePath), "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) {
    const e = new Error(`imsmanifest.xml not found in ${workspacePath}`);
    e.name = "ParserError";
    e.code = "MANIFEST_NOT_FOUND";
    throw e;
  }
  return manifestPath;
}

function resolveViewport(vp) {
  const presets = {
    desktop: { width: 1366, height: 768, scale: 1 },
    tablet: { width: 1024, height: 1366, scale: 1 },
    mobile: { width: 390, height: 844, scale: 1 }
  };
  if (!vp || typeof vp !== 'object') return { width: 1024, height: 768, scale: 1 };
  if (vp.device && presets[vp.device]) return presets[vp.device];
  return { width: vp.width || 1024, height: vp.height || 768, scale: vp.scale || 1 };
}

async function scorm_test_api_integration(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  const capture_api_calls = !!params.capture_api_calls;
  const test_scenario = params.test_scenario || null;
  const session_id = params.session_id || null;

  let manifestOk = false; let schemaversion = null;
  try {
    const manifestPath = ensureManifestPath(workspace);
    const parser = new ManifestParser({ setError: () => {} });
    const parsed = await parser.parseManifestFile(manifestPath);
    schemaversion = parsed?.schemaversion || null;
    manifestOk = true;
  } catch (err) {
    logger?.error('Manifest parsing failed', { error: err.message, code: err.code });
    manifestOk = false;
  }

  if (!RuntimeManager.isSupported) {
    const e = new Error("Electron runtime is required for runtime tests");
    e.code = "ELECTRON_REQUIRED";
    throw e;
  }

  let win = null;
  try {
    const entryPath = await resolveEntryPathFromManifest(workspace);
    if (!entryPath) {
      return {
        api_test_results: {
          initialize_success: false,
          data_model_state: {},
          ...(capture_api_calls ? { api_calls_captured: [] } : {})
        },
        manifest_ok: manifestOk,
        scorm_version: schemaversion,
        scenario_ack: !!test_scenario
      };
    }

    const viewport = resolveViewport(params.viewport);
    sessions.emit && session_id && sessions.emit({ session_id, type: 'runtime:open_start', payload: { entryPath, viewport } });
    win = await RuntimeManager.openPage({ entryPath, viewport });
    sessions.emit && session_id && sessions.emit({ session_id, type: 'runtime:page_opened', payload: { entryPath } });
    await RuntimeManager.injectApiRecorder(win);
    sessions.emit && session_id && sessions.emit({ session_id, type: 'runtime:api_recorder_injected', payload: {} });

    if (test_scenario) {
      const steps = Array.isArray(test_scenario.steps) ? test_scenario.steps.length : 0;
      sessions.emit && session_id && sessions.emit({ session_id, type: 'runtime:scenario_start', payload: { steps } });
      await RuntimeManager.runScenario(win, test_scenario);
      sessions.emit && session_id && sessions.emit({ session_id, type: 'runtime:scenario_complete', payload: { steps } });
    }

    const calls = capture_api_calls ? await RuntimeManager.getCapturedCalls(win) : [];
    if (capture_api_calls && session_id && sessions.emit) {
      sessions.emit({ session_id, type: 'debug:api_calls_captured', payload: { count: calls.length } });
    }
    const initialize_success = !!(calls.find(c => c.method === 'Initialize'));
    return {
      api_test_results: {
        initialize_success,
        data_model_state: {},
        ...(capture_api_calls ? { api_calls_captured: calls } : {})
      },
      manifest_ok: manifestOk,
      scorm_version: schemaversion,
      scenario_ack: !!test_scenario
    };
  } finally {
    if (win) { try { await RuntimeManager.close(win); } catch (_) {} }
  }
}

async function scorm_take_screenshot(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  const session_id = params.session_id || null;
  const viewport = resolveViewport(params.viewport);
  const capture_options = params.capture_options || {};

  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  if (!RuntimeManager.isSupported) {
    const e = new Error("Electron runtime is required for screenshots");
    e.code = "ELECTRON_REQUIRED";
    throw e;
  }

  // Try to locate an entry HTML from manifest
  const entryPath = await resolveEntryPathFromManifest(workspace);

  if (!entryPath) { const e = new Error('No launchable entry found via CAM'); e.code = 'MANIFEST_LAUNCH_NOT_FOUND'; throw e; }

  let win = null;
  try {
    if (entryPath) {
      sessions.emit && session_id && sessions.emit({ session_id, type: 'screenshot:capture_start', payload: { entryPath, viewport } });
      win = await RuntimeManager.openPage({ entryPath, viewport });

      // Optional waits before capture
      const delayMs = Number(capture_options.delay_ms || 0);
      const waitForSelector = capture_options.wait_for_selector;
      const waitTimeoutMs = Number(capture_options.wait_timeout_ms || 5000);

      if (waitForSelector && win?.webContents?.executeJavaScript) {
        const pollScript = `new Promise((resolve) => {
          const sel = ${JSON.stringify(waitForSelector)};
          const start = Date.now();
          const tick = () => {
            try {
              const el = document.querySelector(sel);
              if (el) return resolve(true);
            } catch (e) {}
            if (Date.now() - start > ${waitTimeoutMs}) return resolve(false);
            setTimeout(tick, 100);
          };
          tick();
        })`;
        try { await win.webContents.executeJavaScript(pollScript, true); } catch (_) {}
      }

      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    const pngBuffer = win ? await RuntimeManager.capture(win) : Buffer.from([]);
    const base64 = pngBuffer.length ? pngBuffer.toString('base64') : null;

    let artifactPath = null;
    if (session_id && pngBuffer.length) {
      const id = Date.now();
      const rel = `screenshot_${id}.png`;
      const s = sessions.sessions.get(session_id);
      if (s) {
        artifactPath = path.join(s.workspace, rel);
        fs.writeFileSync(artifactPath, pngBuffer);
        sessions.addArtifact({ session_id, artifact: { type: 'screenshot', path: artifactPath } });
      }
    }

    return { supported: !!win, screenshot_data: base64, entry_found: !!entryPath, artifact_path: artifactPath };
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'CAPTURE_FAILED';
    if (session_id && sessions && sessions.emit) {
      try { sessions.emit({ session_id, type: 'error', payload: { source: 'scorm_take_screenshot', error_code: e.code, message: e.message } }); } catch (_) {}
    }
    throw e;
  } finally {
    if (win) { try { await RuntimeManager.close(win); } catch (_) {} }
  }
}

async function scorm_test_navigation_flow(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  const session_id = params.session_id || null;
  const capture_each_step = !!params.capture_each_step;
  const viewport = resolveViewport(params.viewport);
  const navigation_sequence = Array.isArray(params.navigation_sequence) ? params.navigation_sequence : [];

  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  const entryPath = await resolveEntryPathFromManifest(workspace);
  if (!RuntimeManager.isSupported) {
    const e = new Error("Electron runtime is required for navigation flow testing");
    e.code = "ELECTRON_REQUIRED";
    throw e;
  }

  let win = null;
  const artifacts = [];
  try {
    if (!entryPath) { const e = new Error('No launchable entry found via CAM'); e.code = 'MANIFEST_LAUNCH_NOT_FOUND'; throw e; }
    win = await RuntimeManager.openPage({ entryPath, viewport });
    await RuntimeManager.injectApiRecorder(win);
    sessions.emit && session_id && sessions.emit({ session_id, type: 'navigation:start', payload: { steps: navigation_sequence.length } });

    let stepIndex = 0;
    for (const rawStep of navigation_sequence) {
      stepIndex++;
      const step = String(rawStep || '').toLowerCase();
      sessions.emit && session_id && sessions.emit({ session_id, type: 'trace:sequencing_step', payload: { step, index: stepIndex } });
      // Placeholder: real sequencing integration TBD. For now, simulate minimal waits.
      // Optionally capture after each step
      if (capture_each_step) {
        const png = await RuntimeManager.capture(win);
        if (png && png.length && session_id) {
          const s = sessions.sessions.get(session_id);
          if (s) {
            const rel = `nav_step_${Date.now()}_${stepIndex}.png`;
            const outPath = path.join(s.workspace, rel);
            fs.writeFileSync(outPath, png);
            sessions.addArtifact({ session_id, artifact: { type: 'screenshot', path: outPath } });
            artifacts.push(outPath);
          }
        }
      }
    }

    sessions.emit && session_id && sessions.emit({ session_id, type: 'navigation:completed', payload: { steps_executed: navigation_sequence.length } });
    return { supported: true, entry_found: true, steps_executed: navigation_sequence.length, artifacts };
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'NAV_FLOW_ERROR';
    if (session_id && sessions && sessions.emit) {
      try { sessions.emit({ session_id, type: 'error', payload: { source: 'scorm_test_navigation_flow', error_code: e.code, message: e.message } }); } catch (_) {}
    }
    throw e;
  } finally {
    if (win) { try { await RuntimeManager.close(win); } catch (_) {} }
  }
}

async function scorm_debug_api_calls(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  const session_id = params.session_id || null;
  const detect_anomalies = !!params.detect_anomalies;
  const include_data_model_state = !!params.include_data_model_state;

  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }
  const entryPath = await resolveEntryPathFromManifest(workspace);
  if (!RuntimeManager.isSupported) {
    const e = new Error("Electron runtime is required for API call debugging");
    e.code = "ELECTRON_REQUIRED";
    throw e;
  }
  let win = null;
  try {
    if (!entryPath) { const e = new Error('No launchable entry found via CAM'); e.code = 'MANIFEST_LAUNCH_NOT_FOUND'; throw e; }
    const viewport = resolveViewport(params.viewport);
    sessions.emit && session_id && sessions.emit({ session_id, type: 'debug:api_session_start', payload: { entryPath } });
    win = await RuntimeManager.openPage({ entryPath, viewport });
    await RuntimeManager.injectApiRecorder(win);
    let calls = await RuntimeManager.getCapturedCalls(win);
    const filterMethods = Array.isArray(params.filter_methods) ? params.filter_methods.map(String) : null;
    if (filterMethods && filterMethods.length) {
      calls = calls.filter(c => filterMethods.includes(String(c?.method)));
    }

    // Enhance calls with data model state if requested
    if (include_data_model_state && calls && calls.length > 0) {
      for (const call of calls) {
        if (call.method === 'SetValue' && call.args && call.args.length >= 2) {
          const element = call.args[0];
          try {
            const currentValue = await RuntimeManager.callAPI(win, 'GetValue', [element]);
            call.data_model_state = { [element]: currentValue };
          } catch (_) {
            // Ignore errors reading state
          }
        }
      }
    }

    const metrics = { total_calls: Array.isArray(calls) ? calls.length : 0, by_method: {}, first_ts: null, last_ts: null, duration_ms: 0, methods: [] };
    for (const c of (calls || [])) {
      const m = String(c?.method || '');
      if (m) metrics.by_method[m] = (metrics.by_method[m] || 0) + 1;
      const t = Number(c && c.ts);
      if (Number.isFinite(t)) {
        metrics.first_ts = (metrics.first_ts == null) ? t : Math.min(metrics.first_ts, t);
        metrics.last_ts = (metrics.last_ts == null) ? t : Math.max(metrics.last_ts, t);
      }
    }
    if (metrics.first_ts != null && metrics.last_ts != null) metrics.duration_ms = Math.max(0, metrics.last_ts - metrics.first_ts);
    metrics.methods = Object.keys(metrics.by_method);

    // Detect anomalies if requested
    let anomalies = undefined;
    if (detect_anomalies) {
      anomalies = detectApiAnomalies(calls, win);
    }

    sessions.emit && session_id && sessions.emit({ session_id, type: 'debug:api_session_end', payload: { count: metrics.total_calls } });

    const result = { supported: true, entry_found: true, calls, metrics };
    if (anomalies) {
      result.anomalies = anomalies;
    }
    return result;
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'DEBUG_API_ERROR';
    if (session_id && sessions && sessions.emit) {
      try { sessions.emit({ session_id, type: 'error', payload: { source: 'scorm_debug_api_calls', error_code: e.code, message: e.message } }); } catch (_) {}
    }
    throw e;
  } finally {
    if (win) { try { await RuntimeManager.close(win); } catch (_) {} }
  }
}

/**
 * Detect common API usage anomalies
 * @private
 */
function detectApiAnomalies(calls, win) {
  const anomalies = [];

  if (!calls || calls.length === 0) {
    return anomalies;
  }

  // Track SetValue calls without subsequent Commit
  const setValueIndices = [];
  const commitIndices = [];

  calls.forEach((call, idx) => {
    if (call.method === 'SetValue') {
      setValueIndices.push(idx);
    } else if (call.method === 'Commit') {
      commitIndices.push(idx);
    }
  });

  // Check for SetValue without Commit
  if (setValueIndices.length > 0 && commitIndices.length === 0) {
    anomalies.push({
      type: 'missing_commit',
      severity: 'warning',
      description: `${setValueIndices.length} SetValue call(s) made but Commit never called`,
      affected_calls: setValueIndices,
      recommendation: 'Add Commit() after SetValue calls to persist data to the LMS'
    });
  } else if (setValueIndices.length > commitIndices.length * 5) {
    // More than 5 SetValues per Commit might indicate inefficiency
    anomalies.push({
      type: 'infrequent_commit',
      severity: 'info',
      description: `${setValueIndices.length} SetValue calls but only ${commitIndices.length} Commit calls`,
      recommendation: 'Consider batching SetValue calls followed by a single Commit for better performance'
    });
  }

  // Check for Initialize/Terminate pairing
  const initializeCalls = calls.filter(c => c.method === 'Initialize');
  const terminateCalls = calls.filter(c => c.method === 'Terminate');

  if (initializeCalls.length === 0) {
    anomalies.push({
      type: 'missing_initialize',
      severity: 'error',
      description: 'No Initialize() call detected',
      recommendation: 'Call Initialize() before any other SCORM API methods'
    });
  }

  if (initializeCalls.length > 1) {
    anomalies.push({
      type: 'multiple_initialize',
      severity: 'warning',
      description: `Initialize() called ${initializeCalls.length} times`,
      recommendation: 'Initialize() should only be called once per session'
    });
  }

  if (terminateCalls.length === 0 && initializeCalls.length > 0) {
    anomalies.push({
      type: 'missing_terminate',
      severity: 'warning',
      description: 'Initialize() called but Terminate() never called',
      recommendation: 'Call Terminate() when the learner exits the content'
    });
  }

  // Check for API calls before Initialize
  const firstInitIdx = calls.findIndex(c => c.method === 'Initialize');
  if (firstInitIdx > 0) {
    const callsBeforeInit = calls.slice(0, firstInitIdx).filter(c =>
      c.method !== 'GetLastError' && c.method !== 'GetErrorString' && c.method !== 'GetDiagnostic'
    );
    if (callsBeforeInit.length > 0) {
      anomalies.push({
        type: 'calls_before_initialize',
        severity: 'error',
        description: `${callsBeforeInit.length} API call(s) made before Initialize()`,
        affected_calls: callsBeforeInit.map((_, idx) => idx),
        recommendation: 'Call Initialize() before any GetValue or SetValue calls'
      });
    }
  }

  // Check for GetValue/SetValue after Terminate
  const firstTerminateIdx = calls.findIndex(c => c.method === 'Terminate');
  if (firstTerminateIdx >= 0 && firstTerminateIdx < calls.length - 1) {
    const callsAfterTerminate = calls.slice(firstTerminateIdx + 1).filter(c =>
      c.method === 'GetValue' || c.method === 'SetValue'
    );
    if (callsAfterTerminate.length > 0) {
      anomalies.push({
        type: 'calls_after_terminate',
        severity: 'error',
        description: `${callsAfterTerminate.length} GetValue/SetValue call(s) made after Terminate()`,
        recommendation: 'Do not call GetValue or SetValue after Terminate()'
      });
    }
  }

  return anomalies;
}

async function scorm_trace_sequencing(params = {}) {
  const workspace = params.workspace_path ? path.resolve(params.workspace_path) : null;
  const session_id = params.session_id || null;
  if (!workspace) {
    const e = new Error("workspace_path is required");
    e.code = "MCP_INVALID_PARAMS";
    throw e;
  }

  // Normalize trace level
  const normalizeLevel = (lvl) => {
    const s = String(lvl || 'basic').toLowerCase();
    return s === 'verbose' ? 'verbose' : (s === 'detailed' ? 'detailed' : 'basic');
  };
  const level = normalizeLevel(params.trace_level);
  const levelOrder = { basic: 1, detailed: 2, verbose: 3 };
  const levelVal = levelOrder[level];

  const entryPath = await resolveEntryPathFromManifest(workspace);
  if (!RuntimeManager.isSupported) {
    const e = new Error("Electron runtime is required for sequencing trace");
    e.code = "ELECTRON_REQUIRED";
    throw e;
  }

  let win = null;
  const trace = [];
  const pushTrace = (step, details, reqLevel = 'basic') => {
    const reqVal = levelOrder[reqLevel] || 1;
    if (levelVal >= reqVal) {
      const rec = { step: String(step), time: Date.now(), level: reqLevel };
      if (details && typeof details === 'object') rec.details = details;
      trace.push(rec);
      if (sessions.emit && session_id) {
        try { sessions.emit({ session_id, type: 'trace:sequencing_step', payload: { step: rec.step, level: rec.level, index: trace.length } }); } catch (_) {}
      }
    }
  };

  try {
    if (!entryPath) { const e = new Error('No launchable entry found via CAM'); e.code = 'MANIFEST_LAUNCH_NOT_FOUND'; throw e; }

    const viewport = resolveViewport(params.viewport);
    sessions.emit && session_id && sessions.emit({ session_id, type: 'trace:sequencing_start', payload: { level } });

    pushTrace('start', { viewport }, 'basic');
    pushTrace('manifest_resolved', { entryPath }, 'detailed');

    // Derive simple sequencing summary from manifest (controlMode, item counts)
    try {
      const manifestPath = ensureManifestPath(workspace);
      const parser = new ManifestParser({ setError: () => {} });
      const manifest = await parser.parseManifestFile(manifestPath);
      const orgs = manifest && manifest.organizations;
      const defaultOrgId = orgs && (orgs.default || orgs.defaultOrganization || null);
      const allOrgs = (orgs && Array.isArray(orgs.organizations)) ? orgs.organizations : [];
      const defOrg = allOrgs.find(o => String(o?.identifier) === String(defaultOrgId)) || allOrgs[0] || null;
      const controlMode = (defOrg && defOrg.sequencing && defOrg.sequencing.controlMode) || {};
      // Count items recursively
      const countItems = (node) => {
        let count = 0;
        const walk = (n) => {
          if (!n) return;
          const items = Array.isArray(n.items) ? n.items : [];
          for (const it of items) { count++; walk(it); }
        };
        walk(node);
        return count;
      };
      const itemCount = defOrg ? countItems(defOrg) : 0;
      pushTrace('sn_summary', { defaultOrgId, item_count: itemCount, controlMode }, 'detailed');
      if (levelVal >= levelOrder.verbose && defOrg) {
        const titles = [];
        const walkT = (n) => {
          const items = Array.isArray(n.items) ? n.items : [];
          for (const it of items) { titles.push(it.title || it.identifier || ''); walkT(it); }
        };
        walkT(defOrg);
        pushTrace('sn_activity_titles', { titles: titles.slice(0, 10) }, 'verbose');
      }

    } catch (_) { /* ignore manifest parse issues for tracing */ }

    win = await RuntimeManager.openPage({ entryPath, viewport });
    
    // If real adapter preload is present, initialize SN engine in main and fetch status
    try {
      const manifestPath = ensureManifestPath(workspace);
      if (win && win.webContents) {
        const initRes = await win.webContents.executeJavaScript(
          `window.SCORM_MCP && window.SCORM_MCP.snInvoke ? window.SCORM_MCP.snInvoke('init', ${JSON.stringify({ manifestPath, folderPath: workspace })}) : null`,
          true
        );
        if (initRes && initRes.success) {
          pushTrace('sn_engine_init', { success: true }, 'detailed');
          const statusRes = await win.webContents.executeJavaScript(
            `window.SCORM_MCP && window.SCORM_MCP.snInvoke ? window.SCORM_MCP.snInvoke('status') : null`,
            true
          );
          if (statusRes && statusRes.success) {
            pushTrace('sn_engine_status', statusRes.status || {}, 'detailed');
          }
        }
      }
    } catch (_) { /* ignore if bridge not available */ }
    pushTrace('page_opened', {}, 'basic');

    // Recorder injection helps future detailed tracing
    try {
      await RuntimeManager.injectApiRecorder(win);
      pushTrace('api_recorder_injected', {}, 'detailed');
    } catch (_) {
      // ignore
    }

    // Verbose extras: acknowledge flags and environment
    if (levelVal >= levelOrder.verbose) {
      pushTrace('context_info', { electron: true, viewport }, 'verbose');
    }

    sessions.emit && session_id && sessions.emit({ session_id, type: 'trace:sequencing_end', payload: { steps: trace.length } });
    return { supported: true, entry_found: true, trace, trace_level: level, sequencing_active: true };
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'TRACE_SEQUENCING_ERROR';
    if (session_id && sessions && sessions.emit) {
      try { sessions.emit({ session_id, type: 'error', payload: { source: 'scorm_trace_sequencing', error_code: e.code, message: e.message } }); } catch (_) {}
    }
    throw e;
  } finally {
    if (win) { try { await RuntimeManager.close(win); } catch (_) {} }
  }
}

async function scorm_runtime_open(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const s = sessions.sessions.get(session_id);
  if (!s) { const e = new Error(`Unknown session: ${session_id}`); e.code = 'MCP_UNKNOWN_SESSION'; throw e; }
  if (!RuntimeManager.isSupported) { const e = new Error('Electron runtime is required'); e.code = 'ELECTRON_REQUIRED'; throw e; }
  const viewport = resolveViewport(params.viewport);
  const entryPath = await resolveEntryPathFromManifest(s.package_path);
  if (!entryPath) { const e = new Error('No launchable entry found via CAM'); e.code = 'MANIFEST_LAUNCH_NOT_FOUND'; throw e; }
  sessions.emit && sessions.emit({ session_id, type: 'runtime:persistent_open_start', payload: { entryPath, viewport} });
  const win = await RuntimeManager.openPersistent({ session_id, entryPath, viewport });
  const finalURL = RuntimeManager.getURL(win);
  sessions.emit && sessions.emit({ session_id, type: 'runtime:persistent_opened', payload: { url: finalURL || null } });
  return { runtime_id: session_id, entry_found: true, viewport };
}

async function scorm_runtime_status(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  // Use bridge-aware method that works in both modes
  return await RuntimeManager.getRuntimeStatus(session_id);
}

async function scorm_runtime_close(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const ok = await RuntimeManager.closePersistent(session_id);
  sessions.emit && sessions.emit({ session_id, type: 'runtime:persistent_closed', payload: {} });
  return { success: !!ok };
}

async function scorm_attempt_initialize(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.callAPI(null, 'Initialize', [''], session_id);
  return { result: String(res || '') };
}

async function scorm_attempt_terminate(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.callAPI(null, 'Terminate', [''], session_id);
  return { result: String(res || '') };
}

async function scorm_api_call(params = {}) {
  const session_id = params.session_id;
  const method = params.method;
  const args = Array.isArray(params.args) ? params.args : (Array.isArray(params.arguments) ? params.arguments : []);
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  if (!method || typeof method !== 'string') { const e = new Error('method is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.callAPI(null, method, args, session_id);
  return { result: String(res || '') };
}

/**
 * Get multiple data model elements in one call
 * Supports wildcards for bulk reading (e.g., "cmi.interactions.*")
 */
async function scorm_data_model_get(params = {}) {
  const session_id = params.session_id;
  const elements = params.elements || [];
  const patterns = params.patterns || [];
  const include_metadata = !!params.include_metadata;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  // Collect all elements to fetch
  const elementsToFetch = new Set([...elements]);

  // Expand patterns into specific elements
  for (const pattern of patterns) {
    const expanded = await expandDataModelPattern(session_id, pattern);
    expanded.forEach(el => elementsToFetch.add(el));
  }

  // Fetch all values
  const data = {};
  const metadata = {};
  const errors = [];

  for (const element of elementsToFetch) {
    try {
      const value = await RuntimeManager.callAPI(null, 'GetValue', [element], session_id);
      data[element] = value;

      if (include_metadata) {
        const lastError = await RuntimeManager.callAPI(null, 'GetLastError', [], session_id);
        metadata[element] = {
          error_code: lastError,
          fetched_at: Date.now()
        };
      }
    } catch (err) {
      errors.push({
        element,
        error: err.message || String(err)
      });
    }
  }

  return {
    session_id,
    data,
    metadata: include_metadata ? metadata : undefined,
    errors: errors.length > 0 ? errors : undefined,
    element_count: Object.keys(data).length,
    elements: Object.keys(data)
  };
}

/**
 * Expand a data model pattern (with wildcards) into specific elements
 * @private
 */
async function expandDataModelPattern(session_id, pattern) {
  const elements = [];

  // Handle wildcard patterns
  if (pattern.includes('*')) {
    // cmi.interactions.* -> expand based on _count
    if (pattern.startsWith('cmi.interactions.')) {
      const count = await RuntimeManager.callAPI(null, 'GetValue', ['cmi.interactions._count'], session_id);
      const n = parseInt(count, 10) || 0;

      if (pattern === 'cmi.interactions.*') {
        // Get all interaction fields
        for (let i = 0; i < n; i++) {
          elements.push(
            `cmi.interactions.${i}.id`,
            `cmi.interactions.${i}.type`,
            `cmi.interactions.${i}.timestamp`,
            `cmi.interactions.${i}.correct_responses._count`,
            `cmi.interactions.${i}.weighting`,
            `cmi.interactions.${i}.learner_response`,
            `cmi.interactions.${i}.result`,
            `cmi.interactions.${i}.latency`,
            `cmi.interactions.${i}.description`
          );
        }
      } else {
        // Pattern like cmi.interactions.*.learner_response
        const suffix = pattern.substring('cmi.interactions.*.'.length);
        for (let i = 0; i < n; i++) {
          elements.push(`cmi.interactions.${i}.${suffix}`);
        }
      }
    }
    // cmi.objectives.* -> expand based on _count
    else if (pattern.startsWith('cmi.objectives.')) {
      const count = await RuntimeManager.callAPI(null, 'GetValue', ['cmi.objectives._count'], session_id);
      const n = parseInt(count, 10) || 0;

      if (pattern === 'cmi.objectives.*') {
        for (let i = 0; i < n; i++) {
          elements.push(
            `cmi.objectives.${i}.id`,
            `cmi.objectives.${i}.score.scaled`,
            `cmi.objectives.${i}.score.raw`,
            `cmi.objectives.${i}.score.min`,
            `cmi.objectives.${i}.score.max`,
            `cmi.objectives.${i}.success_status`,
            `cmi.objectives.${i}.completion_status`,
            `cmi.objectives.${i}.description`
          );
        }
      } else {
        const suffix = pattern.substring('cmi.objectives.*.'.length);
        for (let i = 0; i < n; i++) {
          elements.push(`cmi.objectives.${i}.${suffix}`);
        }
      }
    }
    // cmi.score.* -> expand to all score fields
    else if (pattern === 'cmi.score.*') {
      elements.push('cmi.score.scaled', 'cmi.score.raw', 'cmi.score.min', 'cmi.score.max');
    }
    // cmi.learner_preference.* -> expand to all preference fields
    else if (pattern === 'cmi.learner_preference.*') {
      elements.push(
        'cmi.learner_preference.audio_level',
        'cmi.learner_preference.language',
        'cmi.learner_preference.delivery_speed',
        'cmi.learner_preference.audio_captioning'
      );
    }
  } else {
    // No wildcard, just add the element
    elements.push(pattern);
  }

  return elements;
}

/**
 * Get sequencing/navigation state
 *
 * Error handling strategy (fail-fast, no masking):
 * - SN_NOT_INITIALIZED: Expected when scorm_sn_init not called (single-SCO courses) → return success with sn_available: false
 * - SN_INIT_FAILED: Actual error when scorm_sn_init was called but failed → thrown by scorm_sn_init
 * - SN_BRIDGE_ERROR: Real SN engine errors → throw error
 * - SN_BRIDGE_UNAVAILABLE: Bridge not available → throw error
 *
 * This ensures we don't mask real errors while handling expected states gracefully.
 */
async function scorm_nav_get_state(params = {}) {
  const session_id = params.session_id;

  logger?.debug && logger.debug('[scorm_nav_get_state] Starting', { session_id });

  if (!session_id || typeof session_id !== 'string') {
    logger?.error && logger.error('[scorm_nav_get_state] Invalid session_id', { session_id });
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  logger?.debug && logger.debug('[scorm_nav_get_state] Invoking SN status');

  const statusRes = await RuntimeManager.snInvoke(null, 'status', undefined, session_id);

  logger?.debug && logger.debug('[scorm_nav_get_state] SN status response', {
    isNull: statusRes == null,
    success: statusRes?.success,
    error: statusRes?.error,
    hasStatus: !!(statusRes && statusRes.status),
    statusKeys: statusRes?.status ? Object.keys(statusRes.status) : []
  });

  if (statusRes == null) {
    logger?.error && logger.error('[scorm_nav_get_state] SN bridge unavailable');
    const e = new Error('SN bridge unavailable');
    e.code = 'SN_BRIDGE_UNAVAILABLE';
    throw e;
  }

  // SN_NOT_INITIALIZED is expected when scorm_sn_init has not been called (e.g., single-SCO courses)
  // Return success with sn_available: false instead of throwing
  if (!statusRes.success && statusRes.error === 'SN_NOT_INITIALIZED') {
    logger?.debug && logger.debug('[scorm_nav_get_state] SN not initialized (expected for single-SCO)');
    return {
      sn_available: false,
      reason: 'SN_NOT_INITIALIZED',
      message: 'Sequencing not initialized (expected for single-SCO courses or when scorm_sn_init not called)'
    };
  }

  // Other errors are real failures - throw them
  if (!statusRes.success) {
    logger?.error && logger.error('[scorm_nav_get_state] SN bridge error', { error: statusRes.error });
    const e = new Error(statusRes.error || 'SN bridge error');
    e.code = 'SN_BRIDGE_ERROR';
    throw e;
  }

  const result = {
    sn_available: true,
    ...statusRes.status
  };

  logger?.debug && logger.debug('[scorm_nav_get_state] Returning result', {
    sn_available: result.sn_available,
    hasCurrentActivity: !!result.currentActivity,
    resultKeys: Object.keys(result)
  });

  return result;
}

/**
 * Navigate to next activity
 *
 * Error handling: SN_NOT_INITIALIZED → return applicable:false (expected for single-SCO)
 * Real errors (NAV_UNSUPPORTED_ACTION, etc.) → throw error
 */
async function scorm_nav_next(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.snInvoke(null, 'nav', { action: 'continue' }, session_id);
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Navigation not applicable when session not active (normal SCORM behavior)
  // The SN service returns `reason` not `error` for expected states
  if (!res.success && res.nav && res.nav.reason) {
    return {
      success: false,
      applicable: false,
      reason: res.nav.reason
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation error');
    e.code = 'NAV_UNSUPPORTED_ACTION';
    throw e;
  }

  return { success: true, applicable: true };
}

/**
 * Navigate to previous activity
 *
 * Error handling: SN_NOT_INITIALIZED → return applicable:false (expected for single-SCO)
 * Real errors (NAV_UNSUPPORTED_ACTION, etc.) → throw error
 */
async function scorm_nav_previous(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.snInvoke(null, 'nav', { action: 'previous' }, session_id);
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Navigation not applicable when session not active (normal SCORM behavior)
  // The SN service returns `reason` not `error` for expected states
  if (!res.success && res.nav && res.nav.reason) {
    return {
      success: false,
      applicable: false,
      reason: res.nav.reason
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation error');
    e.code = 'NAV_UNSUPPORTED_ACTION';
    throw e;
  }

  return { success: true, applicable: true };
}

/**
 * Navigate to specific activity by choice
 *
 * Error handling: SN_NOT_INITIALIZED → return applicable:false (expected for single-SCO)
 * Real errors (NAV_UNSUPPORTED_ACTION, etc.) → throw error
 */
async function scorm_nav_choice(params = {}) {
  const session_id = params.session_id;
  const targetId = params.targetId || params.target_id || params.activity_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  if (!targetId || typeof targetId !== 'string') { const e = new Error('targetId is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.snInvoke(null, 'nav', { action: 'choice', targetId }, session_id);
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Navigation not applicable when session not active (normal SCORM behavior)
  // The SN service returns `reason` not `error` for expected states
  if (!res.success && res.nav && res.nav.reason) {
    return {
      success: false,
      applicable: false,
      reason: res.nav.reason
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation error');
    e.code = 'NAV_UNSUPPORTED_ACTION';
    throw e;
  }

  return { success: true, applicable: true };
}

async function scorm_sn_init(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const s = sessions.sessions.get(session_id);
  if (!s) { const e = new Error(`Unknown session: ${session_id}`); e.code = 'MCP_UNKNOWN_SESSION'; throw e; }
  const manifestPath = ensureManifestPath(s.package_path);
  const res = await RuntimeManager.snInvoke(null, 'init', { manifestPath, folderPath: s.package_path }, session_id);
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }
  if (!res.success) { const e = new Error(res.error || 'SN init failed'); e.code = 'SN_INIT_FAILED'; throw e; }
  return { success: true };
}

async function scorm_sn_reset(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const res = await RuntimeManager.snInvoke(null, 'reset', undefined, session_id);
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }
  if (!res.success) { const e = new Error(res.error || 'SN reset failed'); e.code = 'SN_RESET_FAILED'; throw e; }
  return { success: true };
}

async function scorm_capture_screenshot(params = {}) {
  const session_id = params.session_id;
  const capture_options = params.capture_options || {};
  const return_base64 = params.return_base64 === true; // Explicit opt-in for base64 data

  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }

  // Bridge mode: delegate to Electron child
  if (!global.__electronBridge || !global.__electronBridge.sendMessage) {
    const e = new Error('Electron bridge not available');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const result = await global.__electronBridge.sendMessage({
    id: ++_ipcMessageIdCounter,
    type: 'runtime_capture',
    params: { session_id, compress: true } // Request compressed screenshot
  });

  const base64 = result.screenshot;
  let artifactPath = null;
  const s = sessions.sessions.get(session_id);
  if (s && base64) {
    const rel = `screenshot_${Date.now()}.jpg`; // Use JPEG for compression
    artifactPath = path.join(s.workspace, rel);
    const imageBuffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(artifactPath, imageBuffer);
    sessions.addArtifact({ session_id, artifact: { type: 'screenshot', path: artifactPath } });
  }

  // Only return base64 if explicitly requested (to avoid token bloat)
  return {
    artifact_path: artifactPath,
    ...(return_base64 ? { screenshot_data: base64 } : {})
  };
}

/**
 * Trace assessment interactions with DOM actions, API calls, and data model state
 * Provides complete before/after correlation for debugging assessment issues
 */
async function scorm_assessment_interaction_trace(params = {}) {
  const session_id = params.session_id;
  const actions = params.actions || [];
  const capture_mode = params.capture_mode || 'standard'; // 'standard' or 'detailed'

  logger?.debug && logger.debug('[scorm_assessment_interaction_trace] Starting', {
    session_id,
    actionCount: actions.length,
    capture_mode
  });

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_assessment_interaction_trace] Invalid session_id', { session_id });
    throw e;
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    const e = new Error('actions array is required and must not be empty');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_assessment_interaction_trace] Invalid actions', {
      isArray: Array.isArray(actions),
      length: actions ? actions.length : 0
    });
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    logger?.error && logger.error('[scorm_assessment_interaction_trace] Runtime not open', { session_id });
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  logger?.debug && logger.debug('[scorm_assessment_interaction_trace] Runtime open, starting trace');

  const steps = [];
  const issues_detected = [];

  // Get initial API call count via IPC
  const initialCalls = await RuntimeManager.getCapturedCalls(null, session_id);
  const initialCallCount = initialCalls ? initialCalls.length : 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const step = {
      action_index: i,
      action: action,
      dom_state_before: null,
      dom_state_after: null,
      api_calls_triggered: [],
      data_model_changes: {},
      timestamp: Date.now()
    };

    try {
      // Capture DOM state before (if detailed mode and selector provided)
      if (capture_mode === 'detailed' && action.selector) {
        try {
          const beforeState = await RuntimeManager.executeJS(null, `
            (() => {
              const el = document.querySelector(${JSON.stringify(action.selector)});
              if (!el) return null;
              return {
                tagName: el.tagName,
                type: el.type,
                value: el.value,
                checked: el.checked,
                textContent: el.textContent?.substring(0, 100),
                classList: Array.from(el.classList)
              };
            })()
          `, session_id);
          step.dom_state_before = beforeState;
        } catch (_) {
          // Ignore DOM query errors
        }
      }

      // Get API call count before action via IPC
      const callsBefore = await RuntimeManager.getCapturedCalls(null, session_id);
      const callCountBefore = callsBefore ? callsBefore.length : 0;

      // Execute the action via IPC
      if (action.type === 'click' && action.selector) {
        await RuntimeManager.executeJS(null, `
          (() => {
            const el = document.querySelector(${JSON.stringify(action.selector)});
            if (el) el.click();
          })()
        `, session_id);
      } else if (action.type === 'fill' && action.selector && action.value !== undefined) {
        await RuntimeManager.executeJS(null, `
          (() => {
            const el = document.querySelector(${JSON.stringify(action.selector)});
            if (el) {
              el.value = ${JSON.stringify(action.value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `, session_id);
      } else if (action.type === 'wait' && action.ms) {
        await new Promise(resolve => setTimeout(resolve, action.ms));
      }

      // Small delay to allow API calls to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture DOM state after
      if (capture_mode === 'detailed' && action.selector) {
        try {
          const afterState = await RuntimeManager.executeJS(null, `
            (() => {
              const el = document.querySelector(${JSON.stringify(action.selector)});
              if (!el) return null;
              return {
                tagName: el.tagName,
                type: el.type,
                value: el.value,
                checked: el.checked,
                textContent: el.textContent?.substring(0, 100),
                classList: Array.from(el.classList)
              };
            })()
          `, session_id);
          step.dom_state_after = afterState;
        } catch (_) {
          // Ignore DOM query errors
        }
      }

      // Get API calls triggered by this action via IPC
      const callsAfter = await RuntimeManager.getCapturedCalls(null, session_id);
      const callCountAfter = callsAfter ? callsAfter.length : 0;

      if (callCountAfter > callCountBefore) {
        const newCalls = callsAfter.slice(callCountBefore);
        step.api_calls_triggered = newCalls.map(call => ({
          method: call.method,
          args: call.args,
          result: call.result,
          error_code: call.error_code,
          timestamp: call.ts
        }));

        // Track data model changes from SetValue calls
        for (const call of newCalls) {
          if (call.method === 'SetValue' && call.args && call.args.length >= 2) {
            const element = call.args[0];
            const value = call.args[1];
            step.data_model_changes[element] = {
              new_value: value,
              set_result: call.result
            };
          }
        }
      }

      steps.push(step);

    } catch (error) {
      step.error = error.message || String(error);
      steps.push(step);
      issues_detected.push({
        step_index: i,
        severity: 'error',
        description: `Action failed: ${error.message || String(error)}`,
        action: action
      });
    }
  }

  // Analyze for common issues
  const allApiCalls = steps.flatMap(s => s.api_calls_triggered);
  const setValueCalls = allApiCalls.filter(c => c.method === 'SetValue');
  const commitCalls = allApiCalls.filter(c => c.method === 'Commit');

  if (setValueCalls.length > 0 && commitCalls.length === 0) {
    issues_detected.push({
      severity: 'warning',
      type: 'missing_commit',
      description: `${setValueCalls.length} SetValue call(s) made but Commit never invoked`,
      recommendation: 'Add Commit() after SetValue calls to persist data'
    });
  }

  // Check for incomplete interaction data
  const interactionElements = Object.keys(steps.flatMap(s => s.data_model_changes))
    .filter(el => el.startsWith('cmi.interactions.'));

  if (interactionElements.length > 0) {
    // Group by interaction index
    const interactionIndices = new Set();
    interactionElements.forEach(el => {
      const match = el.match(/cmi\.interactions\.(\d+)\./);
      if (match) interactionIndices.add(match[1]);
    });

    for (const idx of interactionIndices) {
      const hasResponse = interactionElements.some(el => el === `cmi.interactions.${idx}.learner_response`);
      const hasResult = interactionElements.some(el => el === `cmi.interactions.${idx}.result`);

      if (hasResult && !hasResponse) {
        issues_detected.push({
          severity: 'warning',
          type: 'incomplete_interaction',
          description: `Interaction ${idx} has result set but learner_response is missing`,
          recommendation: 'Set learner_response before setting result'
        });
      }
    }
  }

  const result = {
    steps,
    issues_detected,
    summary: {
      total_actions: actions.length,
      successful_actions: steps.filter(s => !s.error).length,
      total_api_calls: allApiCalls.length,
      data_model_elements_changed: Object.keys(steps.flatMap(s => Object.keys(s.data_model_changes))).length
    }
  };

  logger?.debug && logger.debug('[scorm_assessment_interaction_trace] Returning result', {
    resultKeys: Object.keys(result),
    stepsCount: result.steps?.length || 0,
    issuesCount: result.issues_detected?.length || 0,
    hasSummary: !!result.summary,
    summaryKeys: result.summary ? Object.keys(result.summary) : []
  });

  return result;
}

/**
 * Validate current data model state against expected values
 */
async function scorm_validate_data_model_state(params = {}) {
  const session_id = params.session_id;
  const expected = params.expected || {};

  logger?.debug && logger.debug('[scorm_validate_data_model_state] Starting', {
    session_id,
    expectedElementCount: Object.keys(expected).length
  });

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_validate_data_model_state] Invalid session_id', { session_id });
    throw e;
  }

  if (typeof expected !== 'object' || Object.keys(expected).length === 0) {
    const e = new Error('expected object is required and must not be empty');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_validate_data_model_state] Invalid expected', {
      isObject: typeof expected === 'object',
      keyCount: expected ? Object.keys(expected).length : 0
    });
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    logger?.error && logger.error('[scorm_validate_data_model_state] Runtime not open', { session_id });
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  logger?.debug && logger.debug('[scorm_validate_data_model_state] Runtime open, validating elements');

  const issues = [];
  const matches = [];

  for (const [element, expectedValue] of Object.entries(expected)) {
    try {
      const actualValue = await RuntimeManager.callAPI(null, 'GetValue', [element], session_id);

      if (actualValue === expectedValue) {
        matches.push({ element, expected: expectedValue, actual: actualValue });
      } else {
        const issue = {
          element,
          expected: expectedValue,
          actual: actualValue,
          severity: 'error'
        };

        // Add helpful hints based on common issues
        if (actualValue === '' || actualValue === null || actualValue === undefined) {
          issue.hint = `Element "${element}" was never set - check if SetValue was called`;
        } else if (typeof expectedValue !== typeof actualValue) {
          issue.hint = `Type mismatch: expected ${typeof expectedValue} but got ${typeof actualValue}`;
        } else {
          issue.hint = `Value mismatch: expected "${expectedValue}" but got "${actualValue}"`;
        }

        issues.push(issue);
      }
    } catch (error) {
      issues.push({
        element,
        expected: expectedValue,
        actual: undefined,
        severity: 'error',
        error: error.message || String(error),
        hint: `Failed to read element - it may not exist in the data model`
      });
    }
  }

  const result = {
    valid: issues.length === 0,
    total_elements: Object.keys(expected).length,
    matches: matches.length,
    issues: issues.length > 0 ? issues : undefined,
    matched_elements: matches.map(m => m.element)
  };

  logger?.debug && logger.debug('[scorm_validate_data_model_state] Returning result', {
    resultKeys: Object.keys(result),
    valid: result.valid,
    total_elements: result.total_elements,
    matches: result.matches,
    issuesCount: issues.length,
    hasIssues: !!result.issues,
    matchedElementsCount: result.matched_elements?.length || 0
  });

  return result;
}

/**
 * Get browser console errors from SCORM content
 */
async function scorm_get_console_errors(params = {}) {
  const session_id = params.session_id;
  const since_ts = params.since_ts || 0;
  const severity = params.severity || ['error', 'warning'];

  logger?.debug && logger.debug('[scorm_get_console_errors] Starting', { session_id, since_ts, severity });

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_get_console_errors] Invalid params', { session_id });
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    logger?.error && logger.error('[scorm_get_console_errors] Runtime not open', { session_id });
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  logger?.debug && logger.debug('[scorm_get_console_errors] Runtime open, fetching console messages');

  try {
    // Get console messages from the browser context via IPC
    const consoleMessages = await RuntimeManager.executeJS(null, `
      (() => {
        // Access stored console messages if available
        if (window.__scormConsoleMessages) {
          return window.__scormConsoleMessages;
        }
        return [];
      })()
    `, session_id);

    logger?.debug && logger.debug('[scorm_get_console_errors] Console messages fetched', {
      messageCount: consoleMessages ? consoleMessages.length : 0,
      hasMessages: !!(consoleMessages && consoleMessages.length > 0)
    });

    // Filter by severity and timestamp
    const severitySet = new Set(Array.isArray(severity) ? severity : [severity]);
    const filtered = consoleMessages.filter(msg => {
      if (msg.timestamp < since_ts) return false;
      if (!severitySet.has(msg.level)) return false;
      return true;
    });

    logger?.debug && logger.debug('[scorm_get_console_errors] Messages filtered', {
      originalCount: consoleMessages.length,
      filteredCount: filtered.length
    });

    // Categorize errors
    const categorized = filtered.map(msg => {
      let category = 'runtime';
      const message = msg.message || '';

      if (message.includes('API') || message.includes('SCORM')) {
        category = 'scorm_api';
      } else if (message.includes('SyntaxError')) {
        category = 'syntax';
      } else if (message.includes('network') || message.includes('fetch') || message.includes('XMLHttpRequest')) {
        category = 'network';
      } else if (message.includes('TypeError') || message.includes('ReferenceError')) {
        category = 'runtime';
      }

      return {
        ...msg,
        category
      };
    });

    const result = {
      session_id,
      error_count: categorized.length,
      errors: categorized,
      categories: {
        scorm_api: categorized.filter(e => e.category === 'scorm_api').length,
        syntax: categorized.filter(e => e.category === 'syntax').length,
        runtime: categorized.filter(e => e.category === 'runtime').length,
        network: categorized.filter(e => e.category === 'network').length
      }
    };

    logger?.debug && logger.debug('[scorm_get_console_errors] Returning result', {
      resultKeys: Object.keys(result),
      session_id: result.session_id,
      error_count: result.error_count,
      hasCategories: !!result.categories,
      categoriesKeys: result.categories ? Object.keys(result.categories) : []
    });

    return result;
  } catch (error) {
    logger?.error && logger.error('[scorm_get_console_errors] Error fetching console messages', {
      error: error?.message || String(error),
      stack: error?.stack
    });
    const e = new Error(error?.message || String(error));
    e.code = 'CONSOLE_ERROR_FETCH_FAILED';
    throw e;
  }
}

/**
 * Compare two data model snapshots and return detailed diff
 */
async function scorm_compare_data_model_snapshots(params = {}) {
  const before = params.before || {};
  const after = params.after || {};

  if (typeof before !== 'object' || typeof after !== 'object') {
    const e = new Error('before and after must be objects');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const added = [];
  const changed = [];
  const unchanged = [];
  const removed = [];

  // Find all unique keys
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (!(key in before) && (key in after)) {
      // Added
      added.push({ element: key, value: afterValue });
    } else if ((key in before) && !(key in after)) {
      // Removed
      removed.push({ element: key, value: beforeValue });
    } else if (beforeValue !== afterValue) {
      // Changed
      changed.push({ element: key, before: beforeValue, after: afterValue });
    } else {
      // Unchanged
      unchanged.push({ element: key, value: beforeValue });
    }
  }

  return {
    summary: {
      total_elements: allKeys.size,
      added: added.length,
      changed: changed.length,
      unchanged: unchanged.length,
      removed: removed.length
    },
    added,
    changed,
    unchanged,
    removed
  };
}

/**
 * Wait for a specific SCORM API call to occur
 */
async function scorm_wait_for_api_call(params = {}) {
  const session_id = params.session_id;
  const method = params.method;
  const timeout_ms = params.timeout_ms || 5000;

  logger?.debug && logger.debug('[scorm_wait_for_api_call] Starting', { session_id, method, timeout_ms });

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_wait_for_api_call] Invalid session_id', { session_id });
    throw e;
  }

  if (!method || typeof method !== 'string') {
    const e = new Error('method is required');
    e.code = 'MCP_INVALID_PARAMS';
    logger?.error && logger.error('[scorm_wait_for_api_call] Invalid method', { method });
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    logger?.error && logger.error('[scorm_wait_for_api_call] Runtime not open', { session_id });
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const startTime = Date.now();
  const initialCalls = await RuntimeManager.getCapturedCalls(null, session_id);
  const initialCount = initialCalls ? initialCalls.length : 0;

  logger?.debug && logger.debug('[scorm_wait_for_api_call] Initial state', {
    initialCount,
    hasCalls: !!(initialCalls && initialCalls.length > 0)
  });

  let pollCount = 0;

  // Poll for the API call
  while (Date.now() - startTime < timeout_ms) {
    pollCount++;
    const currentCalls = await RuntimeManager.getCapturedCalls(null, session_id);
    const currentCount = currentCalls ? currentCalls.length : 0;

    if (pollCount % 10 === 0) {
      logger?.debug && logger.debug('[scorm_wait_for_api_call] Polling', {
        pollCount,
        currentCount,
        initialCount,
        elapsed: Date.now() - startTime
      });
    }

    if (currentCount > initialCount) {
      // Check if any new calls match the method
      const newCalls = currentCalls.slice(initialCount);
      const matchingCall = newCalls.find(call => call.method === method);

      logger?.debug && logger.debug('[scorm_wait_for_api_call] New calls detected', {
        newCallsCount: newCalls.length,
        methods: newCalls.map(c => c.method),
        foundMatch: !!matchingCall
      });

      if (matchingCall) {
        const result = {
          found: true,
          call: {
            method: matchingCall.method,
            args: matchingCall.args,
            result: matchingCall.result,
            error_code: matchingCall.error_code,
            timestamp: matchingCall.ts
          },
          elapsed_ms: Date.now() - startTime
        };

        logger?.debug && logger.debug('[scorm_wait_for_api_call] Match found, returning result', {
          resultKeys: Object.keys(result),
          found: result.found,
          hasCall: !!result.call,
          callMethod: result.call?.method,
          elapsed_ms: result.elapsed_ms
        });

        return result;
      }
    }

    // Wait a bit before polling again
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Timeout
  logger?.error && logger.error('[scorm_wait_for_api_call] Timeout waiting for API call', {
    method,
    timeout_ms,
    pollCount,
    elapsed: Date.now() - startTime,
    initialCount,
    finalCount: (await RuntimeManager.getCapturedCalls(null, session_id))?.length || 0
  });
  const e = new Error(`Timeout waiting for API call: ${method}`);
  e.code = 'WAIT_TIMEOUT';
  throw e;
}

/**
 * Get current page context and navigation state
 */
async function scorm_get_current_page_context(params = {}) {
  const session_id = params.session_id;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  try {
    const script = `
      (() => {
        const context = {
          page_type: 'unknown',
          slide_number: null,
          total_slides: null,
          section_title: null,
          progress_percent: null,
          navigation_available: {
            next: false,
            previous: false,
            menu: false
          },
          page_title: document.title || null,
          url: window.location.href
        };

        // Try to detect slide number from common patterns
        const slideIndicators = document.querySelectorAll('[class*="slide-number"], [id*="slide-number"], [class*="page-number"]');
        if (slideIndicators.length > 0) {
          const text = slideIndicators[0].textContent.trim();
          const match = text.match(new RegExp('(\\\\d+)\\\\s*\\\\/\\\\s*(\\\\d+)'));
          if (match) {
            context.slide_number = parseInt(match[1]);
            context.total_slides = parseInt(match[2]);
            context.progress_percent = Math.round((context.slide_number / context.total_slides) * 100);
          }
        }

        // Try to detect section title
        const titleElements = document.querySelectorAll('h1, h2, [class*="section-title"], [class*="module-title"]');
        if (titleElements.length > 0) {
          context.section_title = titleElements[0].textContent.trim();
        }

        // Detect page type based on content
        if (document.querySelector('[class*="question"], [id*="question"], [class*="quiz"], [class*="assessment"]')) {
          context.page_type = 'assessment';
        } else if (document.querySelector('[class*="intro"], [class*="welcome"]')) {
          context.page_type = 'intro';
        } else if (document.querySelector('[class*="summary"], [class*="conclusion"]')) {
          context.page_type = 'summary';
        } else {
          context.page_type = 'content';
        }

        // Check navigation availability
        const nextBtn = document.querySelector('[class*="next"], [id*="next"]') ||
          Array.from(document.querySelectorAll('button')).find(btn => /next/i.test(btn.textContent));
        const prevBtn = document.querySelector('[class*="prev"], [class*="back"], [id*="prev"]') ||
          Array.from(document.querySelectorAll('button')).find(btn => /previous|prev|back/i.test(btn.textContent));
        const menuBtn = document.querySelector('[class*="menu"], [id*="menu"]') ||
          Array.from(document.querySelectorAll('button')).find(btn => /menu/i.test(btn.textContent));

        context.navigation_available.next = !!(nextBtn && !nextBtn.disabled);
        context.navigation_available.previous = !!(prevBtn && !prevBtn.disabled);
        context.navigation_available.menu = !!(menuBtn && !menuBtn.disabled);

        return context;
      })()
    `;

    logger?.debug && logger.debug('[scorm_get_current_page_context] Executing script', { scriptLength: script.length });
    const context = await RuntimeManager.executeJS(null, script, session_id);
    logger?.debug && logger.debug('[scorm_get_current_page_context] Script executed successfully', { hasContext: !!context });

    return context;
  } catch (error) {
    logger?.error && logger.error('[scorm_get_current_page_context] Script execution failed', {
      errorMessage: error?.message,
      errorCode: error?.code,
      errorDetails: error?.details
    });
    const e = new Error(error?.message || String(error));
    e.code = 'PAGE_CONTEXT_ERROR';
    throw e;
  }
}

/**
 * Replay a sequence of API calls to reproduce behavior
 */
async function scorm_replay_api_calls(params = {}) {
  const session_id = params.session_id;
  const calls = params.calls || [];

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!Array.isArray(calls) || calls.length === 0) {
    const e = new Error('calls array is required and must not be empty');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const results = [];
  let failed_at_index = null;
  let error_details = null;

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    try {
      const result = await RuntimeManager.callAPI(null, call.method, call.args || [], session_id);

      results.push({
        index: i,
        method: call.method,
        args: call.args,
        result: result,
        success: true
      });
    } catch (error) {
      failed_at_index = i;
      error_details = {
        method: call.method,
        args: call.args,
        error: error.message || String(error),
        error_code: error.code
      };

      results.push({
        index: i,
        method: call.method,
        args: call.args,
        success: false,
        error: error.message || String(error),
        error_code: error.code
      });

      break; // Stop on first failure
    }
  }

  return {
    success: failed_at_index === null,
    total_calls: calls.length,
    executed_calls: results.length,
    failed_at_index,
    error: error_details,
    results
  };
}

/**
 * Get comprehensive page state in a single call
 * Reduces multiple round-trips by fetching all common state at once
 */
async function scorm_get_page_state(params = {}) {
  const session_id = params.session_id;
  const include_options = params.include || {
    page_context: true,
    interactive_elements: true,
    data_model: true,
    console_errors: true,
    network_requests: false
  };

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  logger?.info && logger.info('[scorm_get_page_state] Starting with options', { include_options });

  // Parallel execution of all requested state queries
  // Build array of promises, filtering out null values
  const promises = [];
  const promiseIndices = {};

  if (include_options.page_context) {
    promiseIndices.page_context = promises.length;
    promises.push(scorm_get_current_page_context({ session_id }));
    logger?.info && logger.info('[scorm_get_page_state] Adding page_context at index', { index: promises.length - 1 });
  }

  if (include_options.interactive_elements) {
    promiseIndices.interactive_elements = promises.length;
    promises.push(scorm_dom_find_interactive_elements({ session_id }));
    logger?.info && logger.info('[scorm_get_page_state] Adding interactive_elements at index', { index: promises.length - 1 });
  }

  if (include_options.data_model) {
    promiseIndices.data_model = promises.length;
    promises.push(scorm_data_model_get({ session_id, patterns: ['cmi.*'] }));
    logger?.info && logger.info('[scorm_get_page_state] Adding data_model at index', { index: promises.length - 1 });
  }

  if (include_options.console_errors) {
    promiseIndices.console_errors = promises.length;
    promises.push(scorm_get_console_errors({ session_id, severity: ['error', 'warning'] }));
    logger?.info && logger.info('[scorm_get_page_state] Adding console_errors at index', { index: promises.length - 1 });
  }

  if (include_options.network_requests) {
    promiseIndices.network_requests = promises.length;
    promises.push(scorm_get_network_requests({ session_id }));
    logger?.info && logger.info('[scorm_get_page_state] Adding network_requests at index', { index: promises.length - 1 });
  }

  logger?.info && logger.info('[scorm_get_page_state] Promise indices', { promiseIndices, promiseCount: promises.length });

  const results = await Promise.allSettled(promises);

  logger?.debug && logger.debug('[scorm_get_page_state] Results', {
    resultCount: results.length,
    statuses: results.map((r, i) => ({ index: i, status: r.status, hasError: !!r.reason }))
  });

  // Map results back to named fields
  const response = {
    page_context: null,
    interactive_elements: null,
    data_model: null,
    console_errors: null,
    network_requests: null,
    timestamp: Date.now(),
    errors: []
  };

  // Populate results based on what was requested
  for (const [key, index] of Object.entries(promiseIndices)) {
    if (results[index].status === 'fulfilled') {
      response[key] = results[index].value;
      const valueKeys = Object.keys(results[index].value || {}).slice(0, 5);
      logger?.info && logger.info(`[scorm_get_page_state] ${key} fulfilled at index ${index}`, { valueKeys });
    } else {
      response.errors.push({
        field: key,
        error: results[index].reason?.message || 'Unknown error'
      });
      logger?.error && logger.error(`[scorm_get_page_state] ${key} rejected at index ${index}`, { error: results[index].reason?.message });
    }
  }

  logger?.debug && logger.debug('[scorm_get_page_state] Returning response', {
    hasPageContext: !!response.page_context,
    hasInteractiveElements: !!response.interactive_elements,
    hasDataModel: !!response.data_model,
    hasConsoleErrors: !!response.console_errors,
    hasNetworkRequests: !!response.network_requests,
    errorCount: response.errors.length
  });

  return response;
}

/**
 * Get slide map for single-SCO courses
 * Discovers all slides with titles and IDs for easy navigation
 */
async function scorm_get_slide_map(params = {}) {
  const session_id = params.session_id;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  try {
    const slideMap = await RuntimeManager.executeJS(null, `
      (() => {
        const slides = [];

        // Strategy 1: Look for slide containers with data attributes
        document.querySelectorAll('[data-slide], [data-slide-id], [class*="slide-"]').forEach((slide, idx) => {
          const slideData = {
            index: idx,
            id: slide.id || slide.getAttribute('data-slide-id') || null,
            title: null,
            selector: slide.id ? '#' + slide.id : null,
            visible: slide.offsetParent !== null
          };

          // Try to extract title
          const titleEl = slide.querySelector('h1, h2, h3, [class*="title"]');
          if (titleEl) {
            slideData.title = titleEl.textContent.trim();
          }

          slides.push(slideData);
        });

        // Strategy 2: If no slides found, look for sections
        if (slides.length === 0) {
          document.querySelectorAll('section, [role="region"]').forEach((section, idx) => {
            slides.push({
              index: idx,
              id: section.id || null,
              title: section.querySelector('h1, h2, h3')?.textContent.trim() || null,
              selector: section.id ? '#' + section.id : 'section:nth-of-type(' + (idx + 1) + ')',
              visible: section.offsetParent !== null
            });
          });
        }

        return {
          total_slides: slides.length,
          current_slide_index: slides.findIndex(s => s.visible),
          slides: slides
        };
      })()
    `, session_id);

    return slideMap;
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'SLIDE_MAP_ERROR';
    throw e;
  }
}

/**
 * Navigate to a specific slide by index, ID, or title
 * Works with single-SCO courses that use slide-based navigation
 */
async function scorm_navigate_to_slide(params = {}) {
  const session_id = params.session_id;
  const slide_identifier = params.slide_identifier; // Can be index, id, or title substring

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (slide_identifier === undefined || slide_identifier === null) {
    const e = new Error('slide_identifier is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  try {
    const script = `
      (() => {
        const identifier = ${JSON.stringify(slide_identifier)};

        // Get all slides
        let slides = Array.from(document.querySelectorAll('[data-slide], [data-slide-id], [class*="slide-"]'));
        if (slides.length === 0) {
          slides = Array.from(document.querySelectorAll('section, [role="region"]'));
        }

        let targetSlide = null;

        // Try to match by index
        if (typeof identifier === 'number') {
          targetSlide = slides[identifier];
        }
        // Try to match by ID
        else if (typeof identifier === 'string') {
          targetSlide = slides.find(s => s.id === identifier);

          // Try to match by title substring
          if (!targetSlide) {
            const searchText = identifier.toLowerCase();
            targetSlide = slides.find(s => {
              const title = s.querySelector('h1, h2, h3')?.textContent.toLowerCase() || '';
              return title.includes(searchText);
            });
          }
        }

        if (!targetSlide) {
          throw new Error('Slide not found: ' + identifier);
        }

        // Navigate to slide (implementation depends on course structure)
        // Strategy 1: Trigger click on navigation button
        const navButtons = document.querySelectorAll('[data-slide-nav], [class*="slide-nav"]');
        const targetButton = Array.from(navButtons).find(btn =>
          btn.getAttribute('data-slide') === targetSlide.id ||
          btn.getAttribute('data-slide-index') === String(slides.indexOf(targetSlide))
        );

        if (targetButton) {
          targetButton.click();
          return { success: true, method: 'button_click', slide_id: targetSlide.id };
        }

        // Strategy 2: Show/hide slides directly
        slides.forEach(s => s.style.display = 'none');
        targetSlide.style.display = '';
        targetSlide.scrollIntoView({ behavior: 'smooth' });

        return {
          success: true,
          method: 'direct_show',
          slide_id: targetSlide.id,
          slide_index: slides.indexOf(targetSlide)
        };
      })()
    `;

    const result = await RuntimeManager.executeJS(null, script, session_id);
    return result;
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'SLIDE_NAVIGATION_ERROR';
    throw e;
  }
}

module.exports = {
  scorm_runtime_open,
  scorm_runtime_status,
  scorm_runtime_close,
  scorm_attempt_initialize,
  scorm_attempt_terminate,
  scorm_api_call,
  scorm_data_model_get,
  scorm_nav_get_state,
  scorm_nav_next,
  scorm_nav_previous,
  scorm_nav_choice,
  scorm_sn_init,
  scorm_sn_reset,
  scorm_capture_screenshot,
  scorm_test_api_integration,
  scorm_take_screenshot,
  scorm_test_navigation_flow,
  scorm_debug_api_calls,
  scorm_trace_sequencing,
  scorm_get_network_requests,
  scorm_assessment_interaction_trace,
  scorm_validate_data_model_state,
  scorm_get_console_errors,
  scorm_compare_data_model_snapshots,
  scorm_wait_for_api_call,
  scorm_get_current_page_context,
  scorm_replay_api_calls,
  scorm_get_page_state,
  scorm_get_slide_map,
  scorm_navigate_to_slide
};

/**
 * Get network requests made by SCORM content
 * Returns all HTTP requests captured during content execution
 */
async function scorm_get_network_requests(params = {}) {
  const session_id = params.session_id;
  const options = params.options || {};
  const filterOptions = {
    resource_types: options.resource_types || null,
    since_ts: options.since_ts || null,
    max_count: options.max_count || null
  };

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC-aware method
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const requests = RuntimeManager.getNetworkRequests(session_id, filterOptions) || [];

  return {
    session_id,
    request_count: requests.length,
    requests
  };
}