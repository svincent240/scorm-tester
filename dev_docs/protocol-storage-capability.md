<!-- Add test plan section -->
## Test Plan (Unit & Integration)

This section lists the minimal automated tests to validate the protocol and origin changes.

1) Unit tests
- PathUtils tests:
  - Verify `toScormProtocolUrl()` produces `scorm-app://` URLs for files inside app root.
  - Verify `handleProtocolRequest()` resolves appRoot-relative and `abs/` absolute-style URLs.
  - Verify `handleProtocolRequest()` returns isUndefinedPath for '/undefined' artifacts.
  - Verify `validatePath()` blocks path traversal.

2) Integration tests
- Launch a headless Electron instance (or run an integration harness) with `USE_STORAGE_CAPABLE_ORIGIN=true`.
- Load a minimal test SCO page that executes:
  - window.localStorage.setItem('scorm-test', 'ok') and read it back.
  - Attempt to discover `API_1484_11` object and call Initialize/Commit (verify API responses).
- Assert that:
  - localStorage access does not throw SecurityError and returns stored value when privileged origin enabled.
  - SCORM API discovery and basic API round-trip succeed.

3) CI / Dev usage
- Provide `test/run_pathutils_tests.js` as a standalone Node test that exercises PathUtils behavior.
- Integration tests require test harness (not added here) and will be invoked in CI only for dev builds with flag enabled.
# Protocol Storage-Capable Origin Design and Migration Plan

Purpose
This document evaluates options and prescribes a safe, testable migration plan to provide a storage-capable origin for SCO content launched by the SCORM Tester. The goal is to stop SCOs from receiving SecurityError when they attempt to access browser storage (window.localStorage) while preserving security and SCORM compliance expectations.

Context and problem statement
- Current behavior: SCO pages are served under the custom scheme scorm-app:// which results in an opaque/null origin in practice. Some third-party SCO runtimes try to access window.localStorage and receive DOMException SecurityError (see logs at [`../../AppData/Roaming/scorm-tester/app.log:563`](../../AppData/Roaming/scorm-tester/app.log:563) and [`../../AppData/Roaming/scorm-tester/app.log:859`](../../AppData/Roaming/scorm-tester/app.log:859)).
- SCORM spec expectation: SCOs must use the RTE API (API_1484_11) for persistent LMS-backed storage (cmi.*) and should not rely on browser storage for compliant behavior. Nevertheless, many SCOs use localStorage as a pragmatic persistence fallback – we need to support testing these SCOs where possible.
- Constraint: Prefer changes in main process / WindowManager rather than modifying third‑party SCO content. All changes must be gated behind a feature flag and thoroughly documented and tested.

Options considered (high level)
1. Mark the custom scheme as privileged via Electron APIs (registerSchemesAsPrivileged) and continue serving files via protocol.registerFileProtocol / registerBufferProtocol.
   - Pros: Minimal infrastructure change; keeps existing file-serving code; can set privileges that make the scheme behave more like a normal origin.
   - Cons: Requires careful configuration; some OS/browser behaviors around "origin" can still differ; must ensure security flags and fetch/CSP behave as intended.
2. Serve course content via a small local HTTP server (embedded, e.g., express) and point SCO launches at http://127.0.0.1:PORT/...
   - Pros: Matches real web origin behavior; storage works predictably; easy debugging.
   - Cons: Requires bundling and managing a server process or in-process server; port management; potential firewall/antivirus issues on some machines.
3. Use file:// or data: with explicit origin handling
   - Pros: file:// can be simple to implement.
   - Cons: file:// origins are not consistent across platforms and often disallow storage; not recommended.
4. Hybrid approach: prefer privileged scheme (Option 1) for production builds and optionally enable a local HTTP server option for dev/test via config flag (Option 2).

Recommendation (preferred)
Implement Option 1 as the canonical approach: register scorm-app as a privileged/custom scheme and use protocol APIs to serve package resources while ensuring the scheme is treated as secure and standard by Electron. Complement this with an optional local HTTP fallback (Option 2) controlled by a configuration flag for dev use and CI.

Key rationale
- The app already relies on a custom protocol (`scorm-app://`) and many dynamic imports / resource URLs are tied to that scheme. Converting to a privileged scheme preserves these URLs while enabling better origin semantics.
- A privileged scheme lets us configure behavior (secure/standard/supportFetchAPI/corsEnabled) so that Web APIs like localStorage and fetch behave more like HTTP origins.
- The local HTTP fallback is useful during development, drain testing, and in environments where privileged scheme behavior is insufficient or restricted.

Security considerations
- Registering a privileged scheme or serving content over HTTP impacts security posture. Per `dev_docs/README.md` guidance, document and gate changes, and avoid enabling risky Electron flags by default.
- Do NOT enable unsafe production flags that disable webSecurity globally. Keep webSecurity enabled in production builds and only allow the feature flag for development & QA.
- Carefully scope the privileged scheme to only allow access to local course resources, not arbitrary files.
- Ensure preload scripts continue to expose the expected electronAPI via contextBridge and do not expose extra privileged APIs to course content.

Design details (implementation sketch)

A. Main process: register scheme as privileged
- Add call early in main process bootstrap before creating BrowserWindow:
  - Example change in [`src/main/main.js:1`](src/main/main.js:1) or the project's `WindowManager` initializer (eg. [`src/main/window-manager.js:1`](src/main/window-manager.js:1)):
    - protocol.registerSchemesAsPrivileged([
        { scheme: 'scorm-app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
      ]);
- This makes the scheme behave more like https:// and enables service worker/fetch behaviors.

B. Main process: register file/buffer protocol handler
- Use protocol.registerFileProtocol or registerBufferProtocol to map scorm-app://abs/... to local files on disk.
- Ensure the handler returns appropriate MIME types and response headers (content-type, caching) and does not return unsafe headers.
- Example (conceptual):
  - protocol.registerFileProtocol('scorm-app', (request, callback) => {
      // parse request.url -> local path
      // validate path is inside allowed package path (prevent path traversal)
      callback({ path: normalizedLocalPath });
    });
- Place this code in [`src/main/window-manager.js:1`](src/main/window-manager.js:1) or [`src/main/main.js:1`](src/main/main.js:1) depending on current architecture.

C. Preload and renderer compatibility
- Ensure the existing preload script (exposed via BrowserWindow.webPreferences.preload) still binds the necessary electronAPI functions used by SCO host pages.
- If origin changes cause dynamic imports to resolv differently, consider updating dynamic import resolution logic to use resolve-scorm-url IPC channel already present in the project (see [`dev_docs/README.md:33`](dev_docs/README.md:33)).

D. Feature flag and configuration
- Add a config flag at runtime and environment variable:
  - USE_STORAGE_CAPABLE_ORIGIN (boolean)
  - DEV_FALLBACK_HTTP_SERVER (optional) to enable local HTTP fallback for dev
- Default: false in production. Enabled in dev/test via environment or UI toggle.

E. Optional dev-only HTTP fallback
- Implement a lightweight embedded server (e.g., express) started by main process when DEV_FALLBACK_HTTP_SERVER is true.
- The server should bind to localhost and pick a free ephemeral port; create the launch URL as http://127.0.0.1:PORT/abs/path/to/index.html.
- Add CLI/test harness to start the server and ensure it shuts down cleanly when the app closes.

Implementation plan (step-by-step)
1. Inventory & locate existing protocol registration:
   - Find where scorm-app protocol is registered. Likely in [`src/main/main.js:1`](src/main/main.js:1) or WindowManager implementation at [`src/main/window-manager.js:1`](src/main/window-manager.js:1).
   - Add tests to confirm current handler behavior and that files are reachable.
2. Add config flags:
   - Introduce `USE_STORAGE_CAPABLE_ORIGIN` in the app config (e.g., environment variable or config file).
   - Wire the flag into `WindowManager` initialization.
3. Register privileged scheme:
   - Add `protocol.registerSchemesAsPrivileged([{ scheme: 'scorm-app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }]);`
   - Place this before `app.whenReady()` or early in main bootstrap as required by Electron.
4. Modify protocol handler:
   - Use existing mapping from scorm-app URLs to package files.
   - Ensure result uses registerFileProtocol or registerBufferProtocol and returns correct MIME types.
   - Strictly validate requested paths against the package root (no path traversal).
5. Update tests and logging:
   - Add diagnostic log lines when the privileged scheme is enabled and when requests are served via the privileged handler.
   - Keep existing renderer diagnostics (content-viewer injection logs).
6. Add optional local HTTP server:
   - Implement a dev-only server module (`src/dev/local-course-server.js`) that serves package files.
   - Add logic in WindowManager to prefer HTTP fallback when `DEV_FALLBACK_HTTP_SERVER` is set.
7. Manual QA and automated tests:
   - Unit tests: In-memory tests for path normalization and protocol handler (validate mapping).
   - Integration tests: Launch a test window using the flag and open a small test SCO that calls localStorage (a minimal test that writes/reads localStorage) and assert no SecurityError.
   - Regression tests: Run SCORM compliance test suite to ensure no behavior changes.
8. Documentation updates:
   - Update [`dev_docs/README.md:95`](dev_docs/README.md:95) and create migration notes in this repo file ([`dev_docs/protocol-storage-capability.md`](dev_docs/protocol-storage-capability.md:1)).
9. Rollout:
   - Enable feature in dev builds behind flag.
   - QA verifies storage access, SCORM API discovery, and security posture.
   - Once validated, prepare an opt-in release for broader testing.
10. Monitoring & rollback:
   - Add telemetry counters for storage access errors (IPC channel renderer-log-error entries where DOMException arises).
   - Roll back by disabling `USE_STORAGE_CAPABLE_ORIGIN`.

Security review checklist
- Confirm `webPreferences.webSecurity` remains enabled in production. If currently disabled only in dev, re-enable for production.
- Ensure protocol handler validates file paths strictly: only allow files inside known package directories.
- Do not expose Node APIs to SCO content. Maintain contextIsolation and preload script constraints.
- Limit or avoid allowing service workers unless explicitly needed.
- Add CSP headers when appropriate for HTTP fallback.

Testing checklist
- Minimal SCO test that runs:
  - Attempt: window.localStorage.setItem('x', 'y') and then read.
  - Expect: no SecurityError and read returns 'y' (only when flag enabled).
- Ensure SCORM API discovery still succeeds: API_1484_11 is found and Initialize()/Commit() calls succeed.
- Validate the content root URL and all dynamic imports continue to resolve correctly (some dynamic imports may use scorm-app:// paths).
- Smoke test: launch multiple packages concurrently, validate no cross-package leakage.

Example code snippets (conceptual)
- Privileged scheme registration (main process)
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'scorm-app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
  ]);
- File protocol handler (main process)
  protocol.registerFileProtocol('scorm-app', (request, callback) => {
    try {
      const url = new URL(request.url);
      // map to local path, e.g., replace 'scorm-app://abs/C|/Users/...' -> 'C:\\Users\\...'
      const localPath = mapScormUrlToLocalPath(url);
      if (!isPathInsidePackage(localPath)) {
        callback({ error: -6 }); // FILE_NOT_FOUND
        return;
      }
      callback({ path: localPath });
    } catch (err) {
      callback({ error: -2 }); // FAILED
    }
  });

Developer notes and next actionable step
- Next immediate task: Inventory where the custom protocol is currently registered in the codebase (identify exact file(s) to modify). This corresponds to the todo: "Inventory current WindowManager / custom-protocol implementation" and should be completed before implementing the code changes.
- After inventory, implement the privileged registration and handler behind `USE_STORAGE_CAPABLE_ORIGIN`, add unit tests, and run the SCORM compliance test suite.

References
- Project docs: [`dev_docs/README.md:1`](dev_docs/README.md:1)
- SCORM guidance used for rationale: [`references/spec_guide_1.md:1`](references/spec_guide_1.md:1)
- App log examples: [`../../AppData/Roaming/scorm-tester/app.log:563`](../../AppData/Roaming/scorm-tester/app.log:563) and [`../../AppData/Roaming/scorm-tester/app.log:859`](../../AppData/Roaming/scorm-tester/app.log:859)