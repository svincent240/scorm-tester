"use strict";

const path = require("path");
const fs = require("fs");
const ManifestParser = require("../../main/services/scorm/cam/manifest-parser");
const sessions = require("../session");
const { RuntimeManager, resolveEntryPathFromManifest } = require("../runtime-manager");
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }

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
    sessions.emit && session_id && sessions.emit({ session_id, type: 'debug:api_session_end', payload: { count: metrics.total_calls } });
    return { supported: true, entry_found: true, calls, metrics };
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
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) return { open: false };
  const url = RuntimeManager.getURL(win);
  const initialize_state = await RuntimeManager.getInitializeState(win);
  const calls = await RuntimeManager.getCapturedCalls(win);
  const last = Array.isArray(calls) && calls.length ? calls[calls.length - 1] : null;
  return { open: true, url, initialize_state, last_api_method: last ? String(last.method || '') : null, last_api_ts: last ? Number(last.ts || 0) : null };
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
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.callAPI(win, 'Initialize', ['']);
  return { result: String(res || '') };
}

async function scorm_attempt_terminate(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.callAPI(win, 'Terminate', ['']);
  return { result: String(res || '') };
}

async function scorm_api_call(params = {}) {
  const session_id = params.session_id;
  const method = params.method;
  const args = Array.isArray(params.args) ? params.args : (Array.isArray(params.arguments) ? params.arguments : []);
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  if (!method || typeof method !== 'string') { const e = new Error('method is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.callAPI(win, method, args);
  return { result: String(res || '') };
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
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const statusRes = await RuntimeManager.snInvoke(win, 'status');
  if (statusRes == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED is expected when scorm_sn_init has not been called (e.g., single-SCO courses)
  // Return success with sn_available: false instead of throwing
  if (!statusRes.success && statusRes.error === 'SN_NOT_INITIALIZED') {
    return {
      sn_available: false,
      reason: 'SN_NOT_INITIALIZED',
      message: 'Sequencing not initialized (expected for single-SCO courses or when scorm_sn_init not called)'
    };
  }

  // Other errors are real failures - throw them
  if (!statusRes.success) {
    const e = new Error(statusRes.error || 'SN bridge error');
    e.code = 'SN_BRIDGE_ERROR';
    throw e;
  }

  return {
    sn_available: true,
    ...statusRes.status
  };
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
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.snInvoke(win, 'nav', { action: 'continue' });
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation unsupported');
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
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.snInvoke(win, 'nav', { action: 'previous' });
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation unsupported');
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
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.snInvoke(win, 'nav', { action: 'choice', targetId });
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }

  // SN_NOT_INITIALIZED means scorm_sn_init was never called - navigation not applicable
  if (!res.success && res.error === 'SN_NOT_INITIALIZED') {
    return {
      success: false,
      applicable: false,
      reason: 'Navigation not applicable (scorm_sn_init not called - expected for single-SCO courses)'
    };
  }

  // Other navigation failures are real errors
  if (!res.success) {
    const e = new Error(res.error || 'Navigation unsupported');
    e.code = 'NAV_UNSUPPORTED_ACTION';
    throw e;
  }

  return { success: true, applicable: true };
}

async function scorm_sn_init(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const s = sessions.sessions.get(session_id);
  if (!s) { const e = new Error(`Unknown session: ${session_id}`); e.code = 'MCP_UNKNOWN_SESSION'; throw e; }
  const manifestPath = ensureManifestPath(s.package_path);
  const res = await RuntimeManager.snInvoke(win, 'init', { manifestPath, folderPath: s.package_path });
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }
  if (!res.success) { const e = new Error(res.error || 'SN init failed'); e.code = 'SN_INIT_FAILED'; throw e; }
  return { success: true };
}

async function scorm_sn_reset(params = {}) {
  const session_id = params.session_id;
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }
  const res = await RuntimeManager.snInvoke(win, 'reset');
  if (res == null) { const e = new Error('SN bridge unavailable'); e.code = 'SN_BRIDGE_UNAVAILABLE'; throw e; }
  if (!res.success) { const e = new Error(res.error || 'SN reset failed'); e.code = 'SN_RESET_FAILED'; throw e; }
  return { success: true };
}

async function scorm_capture_screenshot(params = {}) {
  const session_id = params.session_id;
  const capture_options = params.capture_options || {};
  if (!session_id || typeof session_id !== 'string') { const e = new Error('session_id is required'); e.code = 'MCP_INVALID_PARAMS'; throw e; }
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) { const e = new Error('Runtime not open'); e.code = 'RUNTIME_NOT_OPEN'; throw e; }

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

  const pngBuffer = await RuntimeManager.capture(win);
  const base64 = pngBuffer.length ? pngBuffer.toString('base64') : null;

  let artifactPath = null;
  const s = sessions.sessions.get(session_id);
  if (s && pngBuffer.length) {
    const rel = `screenshot_${Date.now()}.png`;
    artifactPath = path.join(s.workspace, rel);
    fs.writeFileSync(artifactPath, pngBuffer);
    sessions.addArtifact({ session_id, artifact: { type: 'screenshot', path: artifactPath } });
  }

  return { artifact_path: artifactPath, screenshot_data: base64 };
}

module.exports = {
  scorm_runtime_open,
  scorm_runtime_status,
  scorm_runtime_close,
  scorm_attempt_initialize,
  scorm_attempt_terminate,
  scorm_api_call,
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
  scorm_get_network_requests
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

  // Check if runtime is open
  const win = RuntimeManager.getPersistent(session_id);
  if (!win) {
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

