"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const PathUtils = require("../shared/utils/path-utils");

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  static ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  static uid() {
    return crypto.randomBytes(8).toString("hex");
  }

  getRoot() {
    // Place MCP sessions under canonical temp root
    const root = path.join(PathUtils.getTempRoot(), "mcp_sessions");
    SessionManager.ensureDir(root);
    return root;
  }

  getNow() {
    return Date.now();
  }

  resolvePackageInfo(packagePath) {
    if (!packagePath || typeof packagePath !== "string") {
      const e = new Error("package_path is required");
      e.code = "MCP_INVALID_PARAMS";
      throw e;
    }
    const native = path.resolve(packagePath);
    if (!fs.existsSync(native)) {
      const e = new Error(`Package path does not exist: ${native}`);
      e.code = "CONTENT_FILE_MISSING";
      throw e;
    }
    const stat = fs.statSync(native);
    const type = stat.isDirectory() ? "directory" : "file";
    return { native, type };
  }

  validateFolderHasManifest(folderPath) {
    const manifest = path.join(folderPath, "imsmanifest.xml");
    if (!fs.existsSync(manifest)) {
      const e = new Error(`imsmanifest.xml not found in ${folderPath}`);
      e.name = "ParserError";
      e.code = "MANIFEST_NOT_FOUND";
      throw e;
    }
    return manifest;
  }

  open({ package_path, execution = {}, timeout_ms = 0 } = {}) {
    const { native, type } = this.resolvePackageInfo(package_path);

    // Minimal validation for directories
    let manifestPath = null;
    if (type === "directory") {
      manifestPath = this.validateFolderHasManifest(native);
    }

    const id = SessionManager.uid();
    const workspace = path.join(this.getRoot(), id);
    SessionManager.ensureDir(workspace);

    // Create initial artifacts manifest
    const artifactsManifest = path.join(workspace, "artifacts_manifest.json");
    fs.writeFileSync(artifactsManifest, JSON.stringify({ session_id: id, artifacts: [] }, null, 2));

    const now = this.getNow();
    const session = {
      id,
      state: "ready",
      package_path: native,
      package_type: type,
      manifest_path: manifestPath,
      created_at: now,
      last_activity_at: now,
      timeout_ms: Number(timeout_ms) || 0,
      workspace,
      artifacts_manifest_path: artifactsManifest,
      events: [],
      next_event_id: 1,
    };
    this.sessions.set(id, session);

    // Emit an event for open
    this._emit(session, "session:open", { package_type: type });

    return {
      session_id: id,
      workspace,
      state: session.state,
      artifacts_manifest_path: artifactsManifest,
    };
  }

  status({ session_id }) {
    const s = this.sessions.get(session_id);
    if (!s) {
      const e = new Error(`Unknown session: ${session_id}`);
      e.code = "MCP_UNKNOWN_SESSION";
      throw e;
    }
    return {
      state: s.state,
      started_at: s.created_at,
      last_activity_at: s.last_activity_at,
      artifacts_count: Array.isArray(s.events) ? s.events.length : 0,
    };
  }

  events({ session_id, since_event_id = 0, max_events = 100 } = {}) {
    const s = this.sessions.get(session_id);
    if (!s) {
      const e = new Error(`Unknown session: ${session_id}`);
      e.code = "MCP_UNKNOWN_SESSION";
      throw e;
    }
    const start = Math.max(0, Number(since_event_id) || 0);
    const limit = Math.max(1, Math.min(1000, Number(max_events) || 100));
    const evs = s.events.filter(ev => ev.id > start).slice(0, limit);
    return { events: evs, next_event_id: s.next_event_id };
  }

  async close({ session_id }) {
    const s = this.sessions.get(session_id);
    if (!s) {
      const e = new Error(`Unknown session: ${session_id}`);
      e.code = "MCP_UNKNOWN_SESSION";
      throw e;
    }
    s.state = "closing";
    s.last_activity_at = this.getNow();
    this._emit(s, "session:close", {});

    // Close persistent runtime window if open (prevent window leaks)
    try {
      const { RuntimeManager } = require('./runtime-manager');
      await RuntimeManager.closePersistent(session_id);
    } catch (_) {
      // Best-effort cleanup - don't fail session close if runtime cleanup fails
    }

    // We leave artifacts on disk for caller to collect; no deletion here.
    this.sessions.delete(session_id);
    return { success: true, artifacts_manifest_path: s.artifacts_manifest_path };
  }

  addArtifact({ session_id, artifact }) {
    const s = this.sessions.get(session_id);
    if (!s) {
      const e = new Error(`Unknown session: ${session_id}`);
      e.code = "MCP_UNKNOWN_SESSION";
      throw e;
    }
    try {
      const manifestPath = s.artifacts_manifest_path;
      let doc = { session_id: session_id, artifacts: [] };
      if (fs.existsSync(manifestPath)) {
        try { doc = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_) { /* intentionally empty */ }
      }
      if (!Array.isArray(doc.artifacts)) doc.artifacts = [];
      doc.artifacts.push(artifact);
      fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
      this._emit(s, "screenshot:capture_done", { path: artifact.path, type: artifact.type });
      return { success: true, path: artifact.path };
    } catch (err) {
      const e = new Error(`Failed to record artifact: ${err.message}`);
      e.code = "MCP_ARTIFACT_WRITE_FAILED";
      throw e;
    }
  }

  emit({ session_id, type, payload = {} } = {}) {
    const s = this.sessions.get(session_id);
    if (!s) {
      const e = new Error(`Unknown session: ${session_id}`);
      e.code = "MCP_UNKNOWN_SESSION";
      throw e;
    }
    return this._emit(s, type, payload);
  }

  _emit(session, type, payload) {
    const event = { id: session.next_event_id++, ts: this.getNow(), type, payload };
    session.events.push(event);
    session.last_activity_at = event.ts;
    return event;
  }
}

module.exports = new SessionManager();

