"use strict";

const sessions = require("../session");

/**
 * Unified course open: Creates workspace + opens runtime + auto-initializes
 * @param {Object} params - Open parameters
 * @param {string} params.package_path - Path to SCORM package
 * @param {Object} params.viewport - Viewport dimensions (width, height)
 * @param {number} params.timeout_ms - Optional timeout in milliseconds
 * @param {boolean} params.new_attempt - If true, skip JSON loading (hard reset)
 */
async function scorm_open_course(params) {
  const { package_path, viewport, timeout_ms, new_attempt } = params || {};
  
  // Step 1: Create workspace
  // Pass new_attempt flag to session manager so it can be retrieved later
  const sessionResult = await sessions.open({ 
    package_path, 
    timeout_ms,
    new_attempt: !!new_attempt // Store flag for startup phase
  });
  const { session_id } = sessionResult;
  
  // Step 2: Resolve entry path and course ID from manifest
  const { RuntimeManager, resolveEntryPathFromManifest, getManifestIdentifier } = require('../runtime-manager');
  const s = sessions.sessions.get(session_id);
  if (!s) {
    const e = new Error(`Session ${session_id} not found after creation`);
    e.code = 'MCP_UNKNOWN_SESSION';
    throw e;
  }
  
  const entryPath = await resolveEntryPathFromManifest(s.package_path);
  if (!entryPath) {
    const e = new Error('No launchable entry found via CAM');
    e.code = 'MANIFEST_LAUNCH_NOT_FOUND';
    throw e;
  }
  
  const courseId = await getManifestIdentifier(s.package_path) || 'unknown_course';
  const forceNew = !!s.new_attempt; // Retrieved from session created in Step 1
  
  // Step 3: Open runtime (loads course and auto-initializes)
  // forceNew flag skips JSON loading in ScormService.initializeSession()
  await RuntimeManager.openPersistent({ 
    session_id, 
    entryPath,
    viewport: viewport || { width: 1024, height: 768 },
    adapterOptions: {
      courseId,
      forceNew // This flag causes ScormService to skip JSON loading (hard reset)
    }
  });
  
  return {
    session_id,
    workspace: sessionResult.workspace,
    artifacts_manifest_path: sessionResult.artifacts_manifest_path
  };
}

/**
 * Unified course close: Terminates + saves data + closes runtime + cleans up
 */
async function scorm_close_course(params) {
  return sessions.close(params || {});
}

/**
 * Reload course: Two-phase operation (matches GUI reload pattern exactly)
 * 
 * PHASE 1 (Shutdown): Complete course shutdown
 *   - Set cmi.exit='suspend' (allows resume)
 *   - Call Terminate() API
 *   - Save complete data model to JSON (via ScormService.terminate)
 *   - Close runtime window
 * 
 * PHASE 2 (Startup): Fresh course start
 *   - Create new session (new session ID)
 *   - Load JSON if exists AND cmi.exit was 'suspend' (unless force_new=true)
 *   - Initialize SCORM API
 *   - Open content
 * 
 * @param {Object} params - Reload parameters
 * @param {string} params.session_id - Current session ID to close
 * @param {string} params.package_path - Path to SCORM package (for restart)
 * @param {Object} params.viewport - Viewport dimensions (optional)
 * @param {boolean} params.force_new - If true, skip JSON loading (hard reset without deletion)
 */
async function scorm_reload_course(params) {
  const { session_id, package_path, viewport, force_new } = params || {};
  
  if (!session_id) {
    const e = new Error('session_id required for reload');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  if (!package_path) {
    const e = new Error('package_path required for reload');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  // PHASE 1: Unified shutdown
  // This is IDENTICAL to close - uses ScormService.terminate() path
  // Saves data model to JSON for resume (unless force_new is set in Phase 2)
  await scorm_close_course({ session_id });
  
  // PHASE 2: Startup (exactly like initial open)
  // New session created with new ID
  // If force_new=false (default): JSON loaded and restored if cmi.exit='suspend'
  // If force_new=true: JSON loading skipped entirely (hard reset without deletion)
  return scorm_open_course({ 
    package_path, 
    viewport,
    new_attempt: !!force_new
  });
}

/**
 * Clear saved session data (MANUAL CLEANUP TOOL ONLY)
 * 
 * WARNING: This tool is for manual cleanup/testing ONLY. It physically deletes the JSON file.
 * 
 * For normal hard reset (starting fresh without old data), use the force_new flag:
 *   - scorm_open_course({ package_path, new_attempt: true })
 *   - scorm_reload_course({ session_id, package_path, force_new: true })
 * 
 * The force_new flag skips JSON loading WITHOUT deletion, which is safer and faster.
 * 
 * Use this tool ONLY for:
 *   - Manual cleanup between test runs
 *   - Debugging data persistence issues
 *   - Removing corrupted session data
 * 
 * @param {Object} params - Clear parameters
 * @param {string} params.package_path - Path to SCORM package (used to identify course)
 */
async function scorm_clear_saved_data(params) {
  const { package_path } = params || {};
  
  if (!package_path) {
    const e = new Error('package_path required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  const path = require('path');
  const ManifestParser = require('../../main/services/scorm/cam/manifest-parser');
  const fs = require('fs');
  
  // Parse manifest to get course ID
  const manifestPath = path.join(package_path, 'imsmanifest.xml');
  if (!fs.existsSync(manifestPath)) {
    const e = new Error(`imsmanifest.xml not found in ${package_path}`);
    e.code = 'MANIFEST_NOT_FOUND';
    throw e;
  }
  
  const parser = new ManifestParser({ setError: () => {} });
  const parsed = await parser.parseManifestFile(manifestPath);
  const courseId = parsed?.identifier || 'unknown_course';
  
  // This tool runs in Node.js context (server.js), but SessionStore lives in Electron child
  // Send IPC message to Electron child to perform the deletion
  if (!global.__electronBridge) {
    const e = new Error('Electron bridge not available');
    e.code = 'MCP_RUNTIME_NOT_AVAILABLE';
    throw e;
  }
  
  const result = await global.__electronBridge.sendMessage({
    id: Date.now(),
    type: 'session_clear_saved_data',
    params: { course_id: courseId, namespace: 'mcp' }
  });
  
  return { 
    success: true, 
    course_id: courseId,
    note: 'JSON file physically deleted. For normal hard reset, use force_new flag instead.'
  };
}

/**
 * Get course status (wrapper for session status)
 */
async function scorm_course_status(params) {
  return sessions.status(params || {});
}

// Legacy compatibility (will be deprecated)
async function scorm_session_open(params) {
  return sessions.open(params || {});
}

async function scorm_session_close(params) {
  return sessions.close(params || {});
}

module.exports = {
  // New unified API
  scorm_open_course,
  scorm_close_course,
  scorm_reload_course,
  scorm_clear_saved_data,
  scorm_course_status,
  
  // Legacy (deprecated but kept for compatibility)
  scorm_session_open,
  scorm_session_close,
};

