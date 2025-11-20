# SCORM Resume Refactor Plan

## The Problem: Why the Previous Implementation Failed

The previous attempt to implement "Resume" functionality suffered from **Over-Engineering** and **Incorrect Modeling** of the SCORM lifecycle.

### 1. The "Split Brain" Architecture
We treated "Starting a Course" and "Resuming a Course" as two fundamentally different actions.
- **Start:** Created a fresh runtime.
- **Resume:** Used a specialized IPC channel (`scorm:resume-session`) and MCP tool to try and reconstruct a state.

**Consequence:** This doubled the code surface area. Any fix applied to the "Start" logic had to be duplicated or adapted for the "Resume" logic.

### 2. Race Conditions & Timing
By making "Resume" an explicit action triggered *after* or *alongside* launch, we introduced race conditions.
- If the course loaded and called `LMSInitialize()` before the "Resume" logic finished injecting data, the course would see a blank session.
- If the "Resume" logic fired too early, the runtime might not be ready.

### 3. Deviation from LMS Standards
In a real LMS, there is no "Resume" button in the API. There is only "Launch".
- The **LMS Backend** decides if a session is new or resumed based on stored data.
- The **Course** (SCO) simply asks for data. It doesn't know if the user clicked "Start" or "Resume" on the dashboard; it only knows what `cmi.entry` tells it.

---

## The Solution: "Initialize with Data"

We will simplify the architecture by making "Resume" a transparent side-effect of "Launching".

### Core Philosophy
**"Launch is Launch."**
Whether it's the first time or the 100th time, the frontend requests to load a course. The backend handles the state.

### Architecture Changes

#### 1. Unified Launch Path
- **Remove:** `scorm:resume-session` IPC handler.
- **Remove:** `scorm_resume_session` MCP tool.
- **Keep:** The standard `load-course` / `createSession` flow.

#### 2. Persistence Layer (The "Database")
We need a simple way to persist state between app restarts.
- **Mechanism:** A simple JSON file store (e.g., `userData/scorm-sessions/{courseId}.json`).
- **Data:** Stores the full `cmi` object (suspend_data, location, score, completion_status).

#### 3. RuntimeManager: Auto-Hydration
When `RuntimeManager.createSession(courseId, forceNew)` is called:

1.  **Handle Forced Reset:**
    - If `forceNew` is `true`, **delete** `scorm-sessions/{courseId}.json` immediately.
    - This is critical for testers who need to verify "First Launch" behavior without manual cleanup.

2.  **Check Storage:** Does `scorm-sessions/{courseId}.json` exist?

3.  **If No (New Session):**
    - Initialize standard CMI object.
    - Set `cmi.entry` (or `cmi.core.entry`) = `"ab-initio"`.

4.  **If Yes (Potential Resume):**
    - Load the JSON data.
    - **Check Exit Status:** Inspect the stored `cmi.exit` (SCORM 2004) or `cmi.core.exit` (SCORM 1.2).
    - **Condition: Resume (`exit` == "suspend")**
        - Inject stored data into the new Runtime.
        - Set `cmi.entry` = `"resume"`.
    - **Condition: Restart (`exit` != "suspend")**
        - **Do NOT inject data.** Treat as a new attempt.
        - Set `cmi.entry` = `"ab-initio"`.
        - **Why?** If a course fails to set `exit="suspend"`, it is a bug in the course. We must not mask this by auto-resuming. The LMS must strictly follow the standard.

#### 4. Persistence on Commit
When the course calls `LMSCommit()` (SCORM 1.2) or `Commit()` (SCORM 2004):
1.  **Extract:** Get the current state of the `cmi` object from the Runtime.
2.  **Save:** Write it to `scorm-sessions/{courseId}.json`.

#### 5. SCORM Version Compatibility
The logic must abstract over version differences:
- **SCORM 1.2:** Uses `cmi.core.entry` and `cmi.core.exit`.
- **SCORM 2004:** Uses `cmi.entry` and `cmi.exit`.
The hydration logic must check the correct field based on the course version defined in the manifest.

### Benefits
- **Zero Frontend Changes:** The UI doesn't need to know about resuming. It just loads the course.
- **Robustness:** Since data is injected at creation time, it is guaranteed to be there when `LMSInitialize` is called.
- **Simplicity:** We delete more code than we write.

---

## Implementation Checklist

1.  [ ] **Revert** the complex "Resume" IPCs and Tools.
2.  [ ] **Implement** `SessionStore` service (simple JSON read/write).
3.  [ ] **Update** `RuntimeManager` to accept `forceNew` flag.
4.  [ ] **Update** `RuntimeManager` hydration logic:
    -   [ ] Implement `forceNew` deletion.
    -   [ ] Implement `cmi.exit` check (only resume on "suspend").
    -   [ ] Handle both SCORM 1.2 and 2004 namespaces.
5.  [ ] **Update** `RuntimeManager` to write to `SessionStore` on `LMSCommit`.
6.  [ ] **Update** MCP `scorm_session_open` to accept `new_attempt` argument.
7.  [ ] **Verify** that `cmi.sus# SCORM Resume Refactor Plan

## The Problem: Why the Previous Implementation Failed

The previous attempt to implement "Resume" functionality suffered from **Over-Engineering** and **Incorrect Modeling** of the SCORM lifecycle.

### 1. The "Split Brain" Architecture
We treated "Starting a Course" and "Resuming a Course" as two fundamentally different actions.
- **Start:** Created a fresh runtime.
- **Resume:** Used a specialized IPC channel (`scorm:resume-session`) and MCP tool to try and reconstruct a state.

**Consequence:** This doubled the code surface area. Any fix applied to the "Start" logic had to be duplicated or adapted for the "Resume" logic.

### 2. Race Conditions & Timing
By making "Resume" an explicit action triggered *after* or *alongside* launch, we introduced race conditions.
- If the course loaded and called `LMSInitialize()` before the "Resume" logic finished injecting data, the course would see a blank session.
- If the "Resume" logic fired too early, the runtime might not be ready.

### 3. Deviation from LMS Standards
In a real LMS, there is no "Resume" button in the API. There is only "Launch".
- The **LMS Backend** decides if a session is new or resumed based on stored data.
- The **Course** (SCO) simply asks for data. It doesn't know if the user clicked "Start" or "Resume" on the dashboard; it only knows what `cmi.entry` tells it.

---

## The Solution: "Initialize with Data"

We will simplify the architecture by making "Resume" a transparent side-effect of "Launching".

### Core Philosophy
**"Launch is Launch."**
Whether it's the first time or the 100th time, the frontend requests to load a course. The backend handles the state.

### Architecture Changes

#### 1. Unified Launch Path
- **Remove:** `scorm:resume-session` IPC handler.
- **Remove:** `scorm_resume_session` MCP tool.
- **Keep:** The standard `load-course` / `createSession` flow.

#### 2. Persistence Layer (The "Database")
We need a simple way to persist state between app restarts.
- **Mechanism:** A simple JSON file store (e.g., `userData/scorm-sessions/{courseId}.json`).
- **Data:** Stores the full `cmi` object (suspend_data, location, score, completion_status).

#### 3. RuntimeManager: Auto-Hydration
When `RuntimeManager.createSession(courseId, forceNew)` is called:

1.  **Handle Forced Reset:**
    - If `forceNew` is `true`, **delete** `scorm-sessions/{courseId}.json` immediately.
    - This is critical for testers who need to verify "First Launch" behavior without manual cleanup.

2.  **Check Storage:** Does `scorm-sessions/{courseId}.json` exist?

3.  **If No (New Session):**
    - Initialize standard CMI object.
    - Set `cmi.entry` (or `cmi.core.entry`) = `"ab-initio"`.

4.  **If Yes (Potential Resume):**
    - Load the JSON data.
    - **Check Exit Status:** Inspect the stored `cmi.exit` (SCORM 2004) or `cmi.core.exit` (SCORM 1.2).
    - **Condition: Resume (`exit` == "suspend")**
        - Inject stored data into the new Runtime.
        - Set `cmi.entry` = `"resume"`.
    - **Condition: Restart (`exit` != "suspend")**
        - **Do NOT inject data.** Treat as a new attempt.
        - Set `cmi.entry` = `"ab-initio"`.
        - **Why?** If a course fails to set `exit="suspend"`, it is a bug in the course. We must not mask this by auto-resuming. The LMS must strictly follow the standard.

#### 4. Persistence on Commit
When the course calls `LMSCommit()` (SCORM 1.2) or `Commit()` (SCORM 2004):
1.  **Extract:** Get the current state of the `cmi` object from the Runtime.
2.  **Save:** Write it to `scorm-sessions/{courseId}.json`.

#### 5. SCORM Version Compatibility
The logic must abstract over version differences:
- **SCORM 1.2:** Uses `cmi.core.entry` and `cmi.core.exit`.
- **SCORM 2004:** Uses `cmi.entry` and `cmi.exit`.
The hydration logic must check the correct field based on the course version defined in the manifest.

### Benefits
- **Zero Frontend Changes:** The UI doesn't need to know about resuming. It just loads the course.
- **Robustness:** Since data is injected at creation time, it is guaranteed to be there when `LMSInitialize` is called.
- **Simplicity:** We delete more code than we write.

---

## Implementation Checklist

1.  [ ] **Revert** the complex "Resume" IPCs and Tools.
2.  [ ] **Implement** `SessionStore` service (simple JSON read/write).
3.  [ ] **Update** `RuntimeManager` to accept `forceNew` flag.
4.  [ ] **Update** `RuntimeManager` hydration logic:
    -   [ ] Implement `forceNew` deletion.
    -   [ ] Implement `cmi.exit` check (only resume on "suspend").
    -   [ ] Handle both SCORM 1.2 and 2004 namespaces.
5.  [ ] **Update** `RuntimeManager` to write to `SessionStore` on `LMSCommit`.
6.  [ ] **Update** MCP `scorm_session_open` to accept `new_attempt` argument.
7.  [ ] **Verify** that `cmi.sus