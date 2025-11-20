"use strict";

const sessions = require("../session");

/**
 * Unified course open: Creates workspace + opens runtime + auto-initializes
 */
async function scorm_open_course(params) {
  const { package_path, viewport, timeout_ms } = params || {};
  
  // Step 1: Create workspace
  const sessionResult = await sessions.open({ package_path, timeout_ms });
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
  const forceNew = !!s.new_attempt;
  
  // Step 3: Open runtime (loads course and auto-initializes)
  await RuntimeManager.openPersistent({ 
    session_id, 
    entryPath,
    viewport: viewport || { width: 1024, height: 768 },
    adapterOptions: {
      courseId,
      forceNew
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
 * Reload course: Unified shutdown then startup (matches GUI reload pattern)
 * Uses same Terminate-based shutdown as close, then re-opens automatically
 */
async function scorm_reload_course(params) {
  const { session_id, package_path, viewport, force_new } = params || {};
  
  if (!session_id) {
    const e = new Error('session_id required for reload');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  // PHASE 1: Unified shutdown (same as close - calls Terminate, saves JSON)
  await scorm_close_course({ session_id });
  
  // PHASE 2: Startup (exactly like initial open)
  // Re-open with same package - forceNew flag skips JSON loading if set
  if (!package_path) {
    const e = new Error('package_path required for reload');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  return scorm_open_course({ 
    package_path, 
    viewport,
    new_attempt: force_new // Hard reset flag - skips JSON loading without deletion
  });
}

/**
 * Clear saved session data (manual cleanup tool only)
 * Note: This is for manual cleanup/testing. Normal hard reset should use
 * forceNew flag in scorm_open_course which skips JSON loading without deletion.
 */
async function scorm_clear_saved_data(params) {
  const { package_path } = params || {};
  
  if (!package_path) {
    const e = new Error('package_path required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }
  
  // Use SessionStore to delete the saved JSON file
  const SessionStore = require('../../main/services/session-store');
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
  
  const sessionStore = new SessionStore({ namespace: 'mcp' });
  await sessionStore.deleteSession(courseId, 'mcp');
  
  return { success: true, course_id: courseId, note: 'Manual deletion only - prefer forceNew flag for hard reset' };
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

