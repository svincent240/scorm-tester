"use strict";

const path = require("path");
const fs = require("fs");
const ManifestParser = require("../main/services/scorm/cam/manifest-parser");
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }
const PathUtils = require("../shared/utils/path-utils");
const { getPreloadPath, installRealAdapterForWindow } = require("./runtime-adapter");

async function resolveEntryPathFromManifest(workspace) {
  const manifestPath = path.join(workspace, "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) return null;
  const parser = new ManifestParser({ setError: () => {} });
  try {
    const parsed = await parser.parseManifestFile(manifestPath);
    const manifestDir = path.dirname(manifestPath);

    // Prefer CAM-based launch resolution using default organization/item tree
    const orgs = parsed?.organizations || {};
    const defaultOrgId = orgs.default || null;
    const organizations = Array.isArray(orgs.organization) ? orgs.organization : [];
    const org = organizations.find(o => o.identifier === defaultOrgId) || organizations[0] || null;

    // Build resource map for quick lookup
    const resources = Array.isArray(parsed?.resources) ? parsed.resources : [];
    const resById = new Map();
    for (const r of resources) if (r?.identifier) resById.set(r.identifier, r);

    function findFirstLaunchableItem(items) {
      if (!Array.isArray(items)) return null;
      for (const it of items) {
        if (!it) continue;
        // visible, with identifierref pointing to a resource with href
        if (it.identifierref && it.isvisible !== false) {
          const res = resById.get(it.identifierref);
          if (res && res.href) return { item: it, resource: res };
        }
        if (Array.isArray(it.children) && it.children.length) {
          const found = findFirstLaunchableItem(it.children);
          if (found) return found;
        }
      }
      return null;
    }

    const found = org ? findFirstLaunchableItem(org.items || []) : null;
    const resource = found?.resource || null;

    // Strict CAM resolution only: require default org/item -> resource.href
    if (resource && resource.href) {
      const base = resource.resolvedBase || manifestDir;
      const resolved = PathUtils.join(base, resource.href);
      return resolved;
    }
    return null;
  } catch (_) {}
  return null;
}

// Persistent runtime registry keyed by session_id
const _persistentBySession = new Map();

class RuntimeManager {
  static get isSupported() {
    return !!(electron && electron.app && electron.BrowserWindow);
  }

  static async ensureAppReady() {
    if (!this.isSupported) return false;
    const { app } = electron;
    if (app.isReady()) return true;
    try { await app.whenReady(); return true; } catch (_) { return false; }
  }

  static async openPage({ entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    if (!this.isSupported) { const e = new Error("Electron runtime is required"); e.code = "ELECTRON_REQUIRED"; throw e; }
    const ok = await this.ensureAppReady();
    if (!ok) { const e = new Error("Electron app not ready"); e.code = "ELECTRON_REQUIRED"; throw e; }
    const { BrowserWindow } = electron;
    const wp = { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true };
    try { wp.preload = getPreloadPath(); } catch (_) {}
    const win = new BrowserWindow({ show: false, webPreferences: wp });
    // Strictly disable popups, unload prompts, and permissions to keep MCP headless
    try { win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); } catch (_) {}
    try { win.webContents.on('will-prevent-unload', (e) => { try { e.preventDefault(); } catch (_) {} }); } catch (_) {}
    try { win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { try { callback(false); } catch (_) {} }); } catch (_) {}
    if (viewport?.width && viewport?.height) win.setSize(viewport.width, viewport.height);
    const url = 'file://' + entryPath;
    // Always attach real adapter bridge per window BEFORE loading URL to avoid missing handler races
    try { installRealAdapterForWindow(win, adapterOptions || {}); } catch (_) {}

    // Load the URL with explicit handling for Storyline-style redirect that triggers ERR_ABORTED
    try {
      await win.loadURL(url);
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e);
      if (msg.includes('ERR_ABORTED')) {
        // Navigation was aborted (likely immediate redirect). Wait briefly for the new load to finish
        const finished = await new Promise((resolve) => {
          let done = false;
          const cleanup = () => { if (!done) { done = true; resolve(true); } };
          const fail = () => { if (!done) { done = true; resolve(false); } };
          try {
            win.webContents.once('did-finish-load', cleanup);
            win.webContents.once('did-stop-loading', cleanup);
            win.webContents.once('did-fail-load', fail);
          } catch (_) { return resolve(false); }
          setTimeout(() => { if (!done) resolve(false); }, 2000);
        });
        if (!finished) {
          // Build enhanced, fail-fast error message with dir listing
          const fs = require('fs');
          const path = require('path');
          let listing = [];
          try {
            const dir = path.dirname(entryPath);
            listing = fs.readdirSync(dir).sort();
          } catch (_) {}
          const err = new Error(`ERR_ABORTED while loading ${entryPath}. Directory listing for ${path.dirname(entryPath)}: [${listing.join(', ')}]`);
          err.code = 'ERR_ABORTED';
          throw err;
        }
      } else {
        const fs = require('fs');
        const path = require('path');
        let listing = [];
        try {
          const dir = path.dirname(entryPath);
          listing = fs.readdirSync(dir).sort();
        } catch (_) {}
        const err = new Error(`${msg} while loading ${entryPath}. Directory listing for ${path.dirname(entryPath)}: [${listing.join(', ')}]`);
        err.code = 'PAGE_LOAD_FAILED';
        throw err;
      }
    }

    // Log final navigated URL for traceability
    try {
      const finalURL = win?.webContents?.getURL?.() || null;
      if (finalURL) { try { process.stderr.write(`DEBUG: Runtime final URL: ${finalURL}\n`); } catch (_) {} }
    } catch (_) {}

    return win;
  }

  static async openPersistent({ session_id, entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    if (!this.isSupported) { const e = new Error("Electron runtime is required"); e.code = "ELECTRON_REQUIRED"; throw e; }
    if (!session_id) throw new Error("session_id required");
    // Close any existing window first
    await this.closePersistent(session_id);
    const win = await this.openPage({ entryPath, viewport, adapterOptions });
    _persistentBySession.set(session_id, win);
    try { win.on('closed', () => { try { _persistentBySession.delete(session_id); } catch (_) {} }); } catch (_) {}
    return win;
  }

  static getPersistent(session_id) {
    return _persistentBySession.get(session_id) || null;
  }

  static async closePersistent(session_id) {
    const win = _persistentBySession.get(session_id);
    if (win) {
      try { win.destroy(); } catch (_) {}
      _persistentBySession.delete(session_id);
      return true;
    }
    return false;
  }

  static getURL(win) {
    try { return win?.webContents?.getURL() || null; } catch (_) { return null; }
  }

  static async injectApiRecorder(win) {
    // Always real adapter via preload exposes API_1484_11 and __scorm_calls; nothing to inject here.
    return true;
  }

  static async runScenario(win, scenario) {
    if (!scenario || !Array.isArray(scenario.steps)) return;
    for (const step of scenario.steps) {
      if (typeof step === 'string') {
        const name = step.toLowerCase();
        if (name === 'initialize') {
          await win.webContents.executeJavaScript("window.API_1484_11 && window.API_1484_11.Initialize('')");
        } else if (name === 'terminate') {
          await win.webContents.executeJavaScript("window.API_1484_11 && window.API_1484_11.Terminate('')");
        } else if (name.startsWith('setvalue ')) {
          const rest = step.substring('setvalue '.length);
          const idx = rest.indexOf(' ');
          if (idx > 0) {
            const key = rest.substring(0, idx);
            const val = rest.substring(idx + 1);
            await win.webContents.executeJavaScript(`window.API_1484_11 && window.API_1484_11.SetValue(${JSON.stringify(key)}, ${JSON.stringify(val)})`);
          }
        }
      } else if (step && typeof step === 'object' && step.method) {
        const method = String(step.method);
        const args = Array.isArray(step.args) ? step.args : [];
        await win.webContents.executeJavaScript(`(window.API_1484_11 && window.API_1484_11[${JSON.stringify(method)}]) ? window.API_1484_11[${JSON.stringify(method)}].apply(window.API_1484_11, ${JSON.stringify(args)}) : undefined`);
      }
    }
  }

  static async callAPI(win, method, args = []) {
    const m = String(method || '');
    const arr = Array.isArray(args) ? args : [];
    try {
      const has = await win.webContents.executeJavaScript(`!!(window.API_1484_11 && typeof window.API_1484_11[${JSON.stringify(m)}]==='function')`, true);
      if (!has) {
        const e = new Error(`Invalid SCORM method: ${m}`);
        e.code = 'INVALID_SCORM_METHOD';
        throw e;
      }
      const res = await win.webContents.executeJavaScript(`window.API_1484_11[${JSON.stringify(m)}].apply(window.API_1484_11, ${JSON.stringify(arr)})`, true);
      return typeof res === 'string' ? res : String(res);
    } catch (err) {
      if (!err || !err.code) {
        const e = new Error(`SCORM API call failed: ${m}`);
        e.code = 'SCORM_API_ERROR';
        throw e;
      }
      throw err;
    }
  }

  static async getCapturedCalls(win) {
    const script = `(() => {
      try {
        if (Array.isArray(window.__scorm_calls)) return window.__scorm_calls;
        if (window.SCORM_MCP && typeof window.SCORM_MCP.getCalls === 'function') return window.SCORM_MCP.getCalls();
        return [];
      } catch (_) { return []; }
    })()`;
    try { return await win.webContents.executeJavaScript(script, true); } catch (_) { return []; }
  }

  static async getInitializeState(win) {
    const calls = await this.getCapturedCalls(win);
    let state = 'none';
    for (const c of (calls || [])) {
      const m = String(c?.method || '');
      if (m === 'Initialize') state = 'initialized';
      if (m === 'Terminate') state = 'terminated';
    }
    return state;
  }

  static async capture(win) {
    const image = await win.webContents.capturePage();
    return image.toPNG();
  }

  static async snInvoke(win, method, payload) {
    const js = `window.SCORM_MCP && window.SCORM_MCP.snInvoke ? window.SCORM_MCP.snInvoke(${JSON.stringify(method)}, ${payload !== undefined ? JSON.stringify(payload) : 'undefined'}) : null`;
    try { return await win.webContents.executeJavaScript(js, true); } catch (_) { return null; }
  }

  static async close(win) {
    try { win?.destroy(); } catch (_) {}
  }
}

module.exports = { RuntimeManager, resolveEntryPathFromManifest };

