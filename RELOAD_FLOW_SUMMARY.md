# GUI Reload Button Flow Summary

This document outlines the startup and shutdown sequence triggered when the GUI "Reload" button is clicked.

## 1. User Action & Event Trigger
- **User** clicks the "Reload" button in the header.
- **`HeaderControls`** component emits a `course:reload:request` event on the `EventBus`.
  - Payload includes `forceNew: true` if Shift key was held (forces a clean session), otherwise `false` (attempts resume).

## 2. Shutdown Sequence (Renderer)
- **`AppManager`** receives the `course:reload:request` event.
- **`AppManager.handleCourseReload`** executes the shutdown logic:
  1.  **Suspend**: Calls `SetValue('cmi.exit', 'suspend')` on the active SCORM API (unless `forceNew` is true). This marks the session as resumable.
  2.  **Terminate**: Calls `Terminate('')` (SCORM 2004) or `LMSFinish('')` (SCORM 1.2).
  3.  **Persistence Wait**: Waits 300ms to allow the main process to persist data to disk.
  4.  **Fallback**: If no API is found, calls `ipcClient.invoke('close-course')`.

## 3. Reload Sequence (Renderer)
- **`AppManager`** sets an internal flag `_isReloading = true`.
- **`AppManager`** triggers the **`CourseLoader`** to reload the course from its original source path (ZIP or folder).
- **`CourseLoader`** processes the manifest and updates the `UIState`.
- **`UIState`** emits a `course:loaded` event.

## 4. Initialization Sequence (Renderer)
- **`AppManager`** handles `course:loaded`.
- **`AppManager`** calls **`ContentViewer.loadContent(launchUrl, options)`**.
  - Passes `forceNew` option if applicable.
- **`ContentViewer`**:
  1.  **Session Init**: Calls `ipcClient.invoke('scorm-initialize', { sessionId, forceNew })`.
  2.  **Cleanup**: Sets iframe source to `about:blank` and tears down old SCORM API stubs.
  3.  **Setup**: Sets up new SCORM API bridge with the new session ID.
  4.  **Load**: Sets the iframe source to the course `launchUrl`.

## 5. Session Initialization (Main Process)
- **`IpcHandler`** receives `scorm-initialize` and calls **`ScormService.initializeSession`**.
- **`ScormService`**:
  1.  **Session Creation**: Creates a new session object and RTE instance.
  2.  **Hydration (Resume Logic)**:
      - If `forceNew` is **false**: Loads persisted session data from `SessionStore`.
      - Checks `cmi.exit`. If it is `'suspend'`, calls `rte.dataModel.restoreData()` to restore the full data model state.
      - If `forceNew` is **true**: Skips loading and starts fresh.
  3.  **RTE Init**: Calls `rte.Initialize('')` to ready the API for the content.

## 6. Content Start
- The course content loads in the iframe.
- It finds the SCORM API (`window.API_1484_11` or `window.API`).
- It calls `Initialize('')`.
- Since the RTE is already initialized and hydrated, the course resumes from the restored state (if suspended) or starts new.
