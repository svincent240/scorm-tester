### Priority 1: Foundational Changes & Immediate Consolidations

1.  **Re-evaluate and Relax the Strict 200-Line File Limit:**
    *   **Action:** Update the development rules (e.g., in `dev_docs/rules.md` or `dev_docs/style.md`) to replace the rigid 200-line limit with a more flexible guideline. The new guideline should prioritize logical cohesion, single responsibility, and readability, allowing files to be larger (e.g., up to 500-800 lines for complex core modules) if it means containing a complete logical unit and reducing artificial fragmentation.
    *   **Rationale:** This is critical as it unblocks other consolidation efforts and aligns documentation with practical implementation realities. The current rule is widely ignored or leads to worse outcomes.
    *   **Affected Files/Areas:** All modules currently exceeding or artificially constrained by the 200-line limit.

2.  **Consolidate `IpcHandler` and `IpcHandlers`:**
    *   **Action:** Merge the functionality of `src/main/services/ipc-handlers.js` directly into `src/main/services/ipc-handler.js`.
    *   **Rationale:** These two files are tightly coupled and were artificially split. Merging them will create a single, cohesive IPC handling service, improving readability and reducing file count without compromising modularity.
    *   **Affected Files:** `src/main/services/ipc-handler.js`, `src/main/services/ipc-handlers.js`.

3.  **Eliminate Redundant Manifest Parsing in `FileManager` and `ScormService`:**
    *   **Action:**
        *   Remove manifest parsing logic (`parseManifestInfo`, `parseManifestStructure`, `parseItems`) from `src/main/services/file-manager.js`. `FileManager` should strictly focus on raw file system operations (selecting, extracting, saving temporary files).
        *   Remove `validateCompliance` and `analyzeContent` methods from `src/main/services/scorm-service.js`.
        *   Ensure that any component requiring SCORM-specific manifest interpretation (e.g., `CourseLoader` in the renderer, or `ScormService` for orchestration) explicitly calls methods on the `ScormCAMService` (main process) for these operations.
    *   **Rationale:** This directly addresses code duplication, enforces strict separation of concerns, and ensures that the robust CAM module is the single source of truth for SCORM manifest processing.
    *   **Affected Files:** `src/main/services/file-manager.js`, `src/main/services/scorm-service.js`, potentially `src/renderer/services/course-loader.js` (to update its calls).

4.  **Clean Up Debugging and Troubleshooting Artifacts:**
    *   **Action:** Systematically remove or conditionally enable (e.g., via environment variables for development builds) the excessive "CRITICAL DEBUG" and "DIAGNOSTIC" `console.log` statements and comments.
    *   **Rationale:** These artifacts clutter the codebase, reduce readability, and are not suitable for production. A more structured logging approach should be used.
    *   **Affected Files:** `src/renderer/app.js`, `src/renderer/services/scorm-api-bridge.js`, `src/renderer/services/course-loader.js`, `src/renderer/services/app-manager.js`.

### Priority 2: Module Refinements & Consistency

5.  **Consolidate CAM Sub-modules (Conditional):**
    *   **Action:** Re-evaluate the possibility of merging `ManifestParser`, `ContentValidator`, `MetadataHandler`, and `PackageAnalyzer` into a more cohesive `ScormCAMProcessor` (or similar named class) within the `src/main/services/scorm/cam/` directory. This action is contingent on the relaxed line limit (Priority 1.1) allowing for a logically grouped file of reasonable size (e.g., 500-800 lines).
    *   **Rationale:** These modules are tightly related to SCORM package processing. Consolidating them could reduce the number of distinct files and improve the understanding of the overall CAM workflow.
    *   **Affected Files:** `src/main/services/scorm/cam/manifest-parser.js`, `src/main/services/scorm/cam/content-validator.js`, `src/main/services/scorm/cam/metadata-handler.js`, `src/main/services/scorm/cam/package-analyzer.js`, `src/main/services/scorm/cam/index.js`.

6.  **Refactor `PackageAnalyzer`'s Compliance Checks:**
    *   **Action:** Ensure that `src/main/services/scorm/cam/package-analyzer.js` strictly *uses* or *reports on* the results of `ContentValidator` and `ManifestParser` for compliance checks, rather than re-implementing validation logic. Its role should be analysis and reporting, not primary validation.
    *   **Rationale:** Enforces separation of concerns and prevents subtle inconsistencies in validation logic.
    *   **Affected Files:** `src/main/services/scorm/cam/package-analyzer.js`, `src/main/services/scorm/cam/content-validator.js`.

7.  **Review `ScormClient`'s Client-Side Validation:**
    *   **Action:** Examine `src/renderer/services/scorm-client.js`'s `isValidElement` and `isValidValue` methods. If these are a subset of the main process's `ScormDataModel` validation, consider:
        *   Sharing validation schemas/logic (e.g., from `shared/constants/data-model-schema.js`) to ensure consistency.
        *   Clearly defining the client-side role (e.g., for immediate UI feedback only, with server-side as authoritative).
    *   **Rationale:** Reduces potential redundancy and ensures consistency in SCORM data model validation.
    *   **Affected Files:** `src/renderer/services/scorm-client.js`, `src/main/services/scorm/rte/data-model.js`, `src/shared/constants/data-model-schema.js`.

### Priority 3: Ongoing Improvements & Documentation

8.  **Address Incomplete Features/Placeholders:**
    *   **Action:** Review and either complete or explicitly remove placeholder implementations. This includes:
        *   `CourseLoader.createTempFileFromBlob` in `src/renderer/services/course-loader.js`.
        *   `ScormService.processSpecialElement` in `src/main/services/scorm-service.js`.
        *   Placeholder methods in `src/main/services/scorm/cam/manifest-parser.js` (now completed).
        *   "Simplified" checks in `src/main/services/scorm/cam/package-analyzer.js`.
    *   **Rationale:** Reduces technical debt and ensures the application's capabilities are accurately reflected.

9.  **Leverage Modern Language Features and Libraries for Verbosity Reduction:**
    *   **Action:** During refactoring, actively look for opportunities to use more modern JavaScript/TypeScript features (e.g., destructuring, spread syntax, optional chaining) or external libraries (e.g., for more declarative XML parsing or data validation) to reduce boilerplate and verbosity.
    *   **Rationale:** Improves code conciseness, readability, and maintainability.

10. **Streamline Documentation:**
    *   **Action:** Centralize repetitive core principles (like file size guidelines) into a single authoritative document (e.g., `dev_docs/rules.md` or `dev_docs/style.md`) and reference it from other documents. Update existing documentation (e.g., `dev_docs/README.md`, `dev_docs/architecture/overview.md`, module docs) to reflect the revised file size guidelines and any module consolidations.
    *   **Rationale:** Reduces redundancy in documentation, ensures a single source of truth, and keeps documentation aligned with the code.

## Implementation Workflow

This plan will be executed in "Code" mode. Each prioritized action will be broken down into smaller, manageable tasks within the todo list. Comprehensive testing will be performed after each significant change to ensure SCORM compliance and application stability are maintained.