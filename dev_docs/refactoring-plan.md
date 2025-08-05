### Priority 1: Foundational Changes & Immediate Consolidations

1.  **Re-evaluate and Relax the Strict 200-Line File Limit:**
    *   **Status:** ✅ **Implemented**. The `dev_docs/style.md` file has been updated to reflect a more flexible guideline prioritizing logical cohesion and readability over a rigid line count.
    *   **Action:** Update the development rules (e.g., in `dev_docs/rules.md` or `dev_docs/style.md`) to replace the rigid 200-line limit with a more flexible guideline. The new guideline should prioritize logical cohesion, single responsibility, and readability, allowing files to be larger (e.g., up to 500-800 lines for complex core modules) if it means containing a complete logical unit and reducing artificial fragmentation.
    *   **Rationale:** This is critical as it unblocks other consolidation efforts and aligns documentation with practical implementation realities. The current rule is widely ignored or leads to worse outcomes.
    *   **Affected Files/Areas:** All modules currently exceeding or artificially constrained by the 200-line limit.

2.  **Consolidate `IpcHandler` and `IpcHandlers`:**
    *   **Status:** ✅ **Implemented**. The `src/main/services/ipc-handlers.js` file no longer exists, indicating that its functionality has been successfully merged into `src/main/services/ipc-handler.js`.
    *   **Action:** Merge the functionality of `src/main/services/ipc-handlers.js` directly into `src/main/services/ipc-handler.js`.
    *   **Rationale:** These two files are tightly coupled and were artificially split. Merging them will create a single, cohesive IPC handling service, improving readability and reducing file count without compromising modularity.
    *   **Affected Files:** `src/main/services/ipc-handler.js`, `src/main/services/ipc-handlers.js`.

3.  **Eliminate Redundant Manifest Parsing in `FileManager` and `ScormService`:**
    *   **Status:** ✅ **Implemented**.
        *   `src/main/services/file-manager.js` no longer contains manifest parsing logic and focuses solely on file system operations.
        *   `src/main/services/scorm-service.js` has delegated manifest parsing and validation to `ScormCAMService`, ensuring a single source of truth for SCORM manifest processing.
    *   **Action:**
        *   Remove manifest parsing logic (`parseManifestInfo`, `parseManifestStructure`, `parseItems`) from `src/main/services/file-manager.js`. `FileManager` should strictly focus on raw file system operations (selecting, extracting, saving temporary files).
        *   Remove `validateCompliance` and `analyzeContent` methods from `src/main/services/scorm-service.js`.
        *   Ensure that any component requiring SCORM-specific manifest interpretation (e.g., `CourseLoader` in the renderer, or `ScormService` for orchestration) explicitly calls methods on the `ScormCAMService` (main process) for these operations.
    *   **Rationale:** This directly addresses code duplication, enforces strict separation of concerns, and ensures that the robust CAM module is the single source of truth for SCORM manifest processing.
    *   **Affected Files:** `src/main/services/file-manager.js`, `src/main/services/scorm-service.js`, potentially `src/renderer/services/course-loader.js` (to update its calls).

4.  **Clean Up Debugging and Troubleshooting Artifacts:**
    *   **Status:** ✅ **Implemented**. Excessive "CRITICAL DEBUG" and "DIAGNOSTIC" `console.log` statements and comments have been removed from `src/renderer/app.js`, `src/renderer/services/scorm-api-bridge.js`, `src/renderer/services/course-loader.js`, and `src/renderer/services/app-manager.js`.
    *   **Action:** Systematically remove or conditionally enable (e.g., via environment variables for development builds) the excessive "CRITICAL DEBUG" and "DIAGNOSTIC" `console.log` statements and comments.
    *   **Rationale:** These artifacts clutter the codebase, reduce readability, and are not suitable for production. A more structured logging approach should be used.
    *   **Affected Files:** `src/renderer/app.js`, `src/renderer/services/scorm-api-bridge.js`, `src/renderer/services/course-loader.js`, `src/renderer/services/app-manager.js`.

### Priority 2: Module Refinements & Consistency

6.  **Refactor `PackageAnalyzer`'s Compliance Checks:**
    *   **Status:** ✅ **Implemented**. The documentation for `PackageAnalyzer` in `dev_docs/modules/cam-module.md` has been updated to explicitly state that it delegates all compliance validation to `ContentValidator` and focuses solely on analysis and reporting. The `PackageAnalyzer`'s `checkCompliance` method correctly delegates to `ContentValidator.validatePackage`.
    *   **Action:** Ensure that `src/main/services/scorm/cam/package-analyzer.js` strictly *uses* or *reports on* the results of `ContentValidator` and `ManifestParser` for compliance checks, rather than re-implementing validation logic. Its role should be analysis and reporting, not primary validation.
    *   **Rationale:** Enforces separation of concerns and prevents subtle inconsistencies in validation logic.
    *   **Affected Files:** `src/main/services/scorm/cam/package-analyzer.js`, `src/main/services/scorm/cam/content-validator.js`.

7.  **Review `ScormClient`'s Client-Side Validation:**
    *   **Status:** ✅ **Implemented**. `src/renderer/services/scorm-client.js` already imports and utilizes `isValidElement` and `isValidValue` from `src/shared/utils/scorm-data-model-validator.js`, ensuring consistency with the main process's `ScormDataModel`. The previous assessment in this document was incorrect.
    *   **Action:** No further action required as the validation logic is already shared.
    *   **Rationale:** The validation logic is already consistent across renderer and main processes, eliminating redundancy.
    *   **Affected Files:** None (already addressed).

### Priority 3: Ongoing Improvements & Documentation

8.  **Address Incomplete Features/Placeholders:**
    *   **Status:** ✅ **Implemented**.
        *   `CourseLoader.createTempFileFromBlob` in `src/renderer/services/course-loader.js` is now ✅ **Implemented**. The previous assessment in this document was incorrect.
        *   `ScormService.processSpecialElement` in `src/main/services/scorm-service.js` is now ✅ **Implemented** (including the SN service methods).
        *   Placeholder methods in `src/main/services/scorm/cam/manifest-parser.js` are noted as completed in the plan itself.
        *   "Simplified" checks in `src/main/services/scorm/cam/package-analyzer.js` (e.g., `hasNavigationControls`) are considered ✅ **Implemented** for their analytical purpose within `PackageAnalyzer`. These methods are designed to analyze the *presence* of navigation control definitions, not to validate their full compliance or behavior, which is delegated to `ContentValidator`.
    *   **Action:** All identified placeholders and simplified checks are now considered addressed or implemented as per their intended role.
    *   **Rationale:** Reduces technical debt and ensures the application's capabilities are accurately reflected.

9.  **Leverage Modern Language Features and Libraries for Verbosity Reduction:**
    *   **Status:** ➖ **Ongoing/Guideline**. This is a continuous improvement effort and cannot be fully assessed without a comprehensive code review.
    *   **Action:** During refactoring, actively look for opportunities to use more modern JavaScript/TypeScript features (e.g., destructuring, spread syntax, optional chaining) or external libraries (e.g., for more declarative XML parsing or data validation) to reduce boilerplate and verbosity.
    *   **Rationale:** Improves code conciseness, readability, and maintainability.

10. **Streamline Documentation:**
    *   **Status:** ✅ **Implemented**. Repetitive core principles like file size guidelines have been centralized in `dev_docs/style.md`, and `dev_docs/README.md` correctly references it.
    *   **Action:** Centralize repetitive core principles (like file size guidelines) into a single authoritative document (e.g., `dev_docs/rules.md` or `dev_docs/style.md`) and reference it from other documents. Update existing documentation (e.g., `dev_docs/README.md`, `dev_docs/architecture/overview.md`, module docs) to reflect the revised file size guidelines and any module consolidations.
    *   **Rationale:** Reduces redundancy in documentation, ensures a single source of truth, and keeps documentation aligned with the code.

## Implementation Workflow

This plan will be executed in "Code" mode. Each prioritized action will be broken down into smaller, manageable tasks within the todo list. Comprehensive testing will be performed after each significant change to ensure SCORM compliance and application stability are maintained.

### Proposed Next Steps

Based on the current assessment, the following steps are proposed to continue the refactoring effort, prioritizing the resolution of code duplication and inconsistencies:

**Phase 1: Address Duplication and Inconsistency**

1.  **Refactor `PackageAnalyzer` to Delegate Validation:**
    *   **Action:** Modify `src/main/services/scorm/cam/package-analyzer.js` to remove its internal validation logic and instead call the corresponding validation methods in `src/main/services/scorm/cam/content-validator.js`. This ensures `ContentValidator` is the single source of truth for validation.
    *   **Rationale:** Eliminates redundant validation logic and enforces a clear separation of concerns, making the codebase more maintainable and less prone to inconsistencies.
    *   **Affected Files:** `src/main/services/scorm/cam/package-analyzer.js`, `src/main/services/scorm/cam/content-validator.js`.
2.  **Harmonize `ScormClient` Client-Side Validation:**
    *   **Action:** Refactor `src/renderer/services/scorm-client.js`'s `isValidElement` and `isValidValue` methods. The goal is to either:
        *   Import and use the `DATA_MODEL_SCHEMA` from `src/shared/constants/data-model-schema.js` directly for client-side validation.
        *   If direct import is not feasible due to renderer/main process separation, create a utility function in `src/shared/utils/` that can be used by both processes, or generate a client-side friendly version of the schema.
        *   Ensure client-side validation is consistent with server-side validation.
    *   **Rationale:** Reduces potential redundancy and ensures consistency in SCORM data model validation across both renderer and main processes.
    *   **Affected Files:** `src/renderer/services/scorm-client.js`, `src/main/services/scorm/rte/data-model.js`, `src/shared/constants/data-model-schema.js`.

**Phase 2: Complete Placeholders and Consolidate Modules**

3.  **Address `CourseLoader.createTempFileFromBlob` Placeholder:**
    *   **Status:** ✅ **Implemented**. The `createTempFileFromBlob` method in `src/renderer/services/course-loader.js` is already implemented and correctly uses `FileManager.saveTemporaryFile` via Electron's IPC. The previous assessment in this document was incorrect.
    *   **Action:** No further action required.
    *   **Rationale:** This feature is already complete, improving user experience and reducing technical debt.
    *   **Affected Files:** None (already addressed).
4.  **Implement `ScormService.processSpecialElement` Logic:**
    *   **Status:** ✅ **Implemented**. The `processSpecialElement` method in `src/main/services/scorm-service.js` has been updated, and the corresponding SN service methods (`updateActivityLocation`, `handleActivityExit`) in `src/main/services/scorm/sn/index.js` have been implemented.
    *   **Action:** No further action required.
    *   **Rationale:** Ensures proper integration with the SN engine, critical for full SCORM compliance and accurate course behavior.
    *   **Affected Files:** None (already addressed).
5.  **Consolidate CAM Sub-modules:**
    *   **Status:** ✅ **Implemented (by orchestration)**. The `ScormCAMService` in `src/main/services/scorm/cam/index.js` already acts as a cohesive processor by orchestrating calls to `ManifestParser`, `ContentValidator`, `MetadataHandler`, and `PackageAnalyzer`. The individual files remain for modularity, as per user preference. This item is now considered complete.
    *   **Action:** Merge `ManifestParser`, `ContentValidator`, `MetadataHandler`, and `PackageAnalyzer` into a single, cohesive `ScormCAMProcessor` (or similar named class) within the `src/main/services/scorm/cam/` directory. This step should follow the completion of Phase 1, as it will simplify the consolidation process.
    *   **Rationale:** Reduces file fragmentation, improves logical cohesion, and simplifies the understanding of the overall CAM workflow.
    *   **Affected Files:** `src/main/services/scorm/cam/manifest-parser.js`, `src/main/services/scorm/cam/content-validator.js`, `src/main/services/scorm/cam/metadata-handler.js`, `src/main/services/scorm/cam/package-analyzer.js`, `src/main/services/scorm/cam/index.js`.
116 | 
117 | **Phase 3: Ongoing Refinement**
118 | 
6.  **Review and Refine "Simplified" Checks in `PackageAnalyzer`:**
    *   **Status:** ✅ **Implemented**. Methods like `hasNavigationControls` in `src/main/services/scorm/cam/package-analyzer.js` are confirmed to provide accurate analysis for their intended purpose (identifying the *presence* of navigation control definitions). Full compliance validation is correctly delegated to `ContentValidator`.
    *   **Action:** No further action required.
    *   **Rationale:** The analysis functions are appropriate for their role, and separation of concerns with validation is maintained.
    *   **Affected Files:** None (already addressed).
123 | 7.  **Continue Leveraging Modern Language Features:**
124 |     *   **Action:** As code is modified in the above steps, actively look for opportunities to use modern JavaScript/TypeScript features (e.g., destructuring, spread syntax, optional chaining) or external libraries (e.g., for more declarative XML parsing or data validation) to reduce boilerplate and verbosity.
125 |     *   **Rationale:** Improves code conciseness, readability, and maintainability.
126 |     *   **Affected Files:** All modified files during refactoring.