/**
 * SCORM 2004 4th Edition TypeScript Definitions
 * 
 * Complete type definitions for SCORM 2004 4th Edition implementation
 * including API interfaces, data model types, and error handling.
 * 
 * These definitions provide:
 * - IntelliSense support for AI tools
 * - Type safety for development
 * - Documentation for API usage
 * - Compliance validation support
 * 
 * @fileoverview SCORM 2004 4th Edition TypeScript definitions
 */

// ============================================================================
// SCORM API Interface (8 Required Functions)
// ============================================================================

/**
 * SCORM 2004 4th Edition API Interface
 * 
 * Defines the 8 required SCORM API functions as specified in
 * the Run-Time Environment specification.
 */
export interface ScormAPI {
  /**
   * Initialize the SCORM session
   * @param parameter Must be empty string ""
   * @returns "true" if successful, "false" if error
   */
  Initialize(parameter: ""): "true" | "false";

  /**
   * Terminate the SCORM session
   * @param parameter Must be empty string ""
   * @returns "true" if successful, "false" if error
   */
  Terminate(parameter: ""): "true" | "false";

  /**
   * Get value from data model element
   * @param element Data model element name (e.g., "cmi.completion_status")
   * @returns Element value as string, or empty string on error
   */
  GetValue(element: string): string;

  /**
   * Set value in data model element
   * @param element Data model element name
   * @param value Value to set (always string in SCORM)
   * @returns "true" if successful, "false" if error
   */
  SetValue(element: string, value: string): "true" | "false";

  /**
   * Commit data to persistent storage
   * @param parameter Must be empty string ""
   * @returns "true" if successful, "false" if error
   */
  Commit(parameter: ""): "true" | "false";

  /**
   * Get last error code
   * @returns Error code as string (e.g., "0", "101", "404")
   */
  GetLastError(): string;

  /**
   * Get error string for given error code
   * @param errorCode Error code to get string for
   * @returns Human-readable error string or empty string
   */
  GetErrorString(errorCode: string): string;

  /**
   * Get diagnostic information for error code
   * @param errorCode Error code to get diagnostic for
   * @returns Diagnostic information or empty string
   */
  GetDiagnostic(errorCode: string): string;
}

// ============================================================================
// Data Model Types
// ============================================================================

/**
 * SCORM Completion Status Values
 */
export type CompletionStatus = 'completed' | 'incomplete' | 'not attempted' | 'unknown';

/**
 * SCORM Success Status Values
 */
export type SuccessStatus = 'passed' | 'failed' | 'unknown';

/**
 * SCORM Exit Status Values
 */
export type ExitStatus = 'time-out' | 'suspend' | 'logout' | 'normal' | '';

/**
 * SCORM Entry Status Values
 */
export type EntryStatus = 'ab-initio' | 'resume' | '';

/**
 * SCORM Lesson Mode Values
 */
export type LessonMode = 'normal' | 'browse' | 'review';

/**
 * SCORM Credit Values
 */
export type Credit = 'credit' | 'no-credit';

/**
 * SCORM Session States
 */
export type SessionState = 'not_initialized' | 'running' | 'terminated';

/**
 * SCORM Interaction Types
 */
export type InteractionType = 
  | 'true-false' 
  | 'choice' 
  | 'fill-in' 
  | 'long-fill-in'
  | 'matching' 
  | 'performance' 
  | 'sequencing' 
  | 'likert'
  | 'numeric' 
  | 'other';

/**
 * SCORM Interaction Results
 */
export type InteractionResult = 'correct' | 'incorrect' | 'unanticipated' | 'neutral';

/**
 * SCORM Navigation Requests
 */
export type NavigationRequest = 
  | 'continue' 
  | 'previous' 
  | 'exit' 
  | 'exitAll'
  | 'abandon' 
  | 'abandonAll' 
  | 'suspendAll' 
  | 'start' 
  | 'resumeAll';

// ============================================================================
// Data Model Element Interfaces
// ============================================================================

/**
 * SCORM Score Information
 */
export interface ScormScore {
  scaled?: number;  // -1 to 1
  raw?: number;
  min?: number;
  max?: number;
}

/**
 * SCORM Interaction Data
 */
export interface ScormInteraction {
  id: string;
  type?: InteractionType;
  objectives?: string[];
  timestamp?: string;
  correct_responses?: string[];
  weighting?: number;
  learner_response?: string;
  result?: InteractionResult;
  latency?: string;
  description?: string;
}

/**
 * SCORM Objective Data
 */
export interface ScormObjective {
  id: string;
  score?: ScormScore;
  success_status?: SuccessStatus;
  completion_status?: CompletionStatus;
  description?: string;
}

/**
 * SCORM Comment Data
 */
export interface ScormComment {
  comment: string;
  location?: string;
  timestamp?: string;
}

/**
 * SCORM Learner Preferences
 */
export interface LearnerPreferences {
  audio_level?: number;      // 0-100
  language?: string;
  delivery_speed?: number;   // 0-100
  audio_captioning?: number; // -1, 0, 1
}

// ============================================================================
// Error Handling Types
// ============================================================================

/**
 * SCORM Error Categories
 */
export type ErrorCategory = 
  | 'success' 
  | 'general' 
  | 'initialization' 
  | 'termination' 
  | 'data_model' 
  | 'reserved';

/**
 * SCORM Error State Information
 */
export interface ErrorState {
  lastError: string;
  lastErrorString: string;
  lastDiagnostic: string;
  sessionState: SessionState;
  hasError: boolean;
  errorCategory: ErrorCategory;
}

/**
 * Error History Entry
 */
export interface ErrorHistoryEntry {
  timestamp: string;
  errorCode: string;
  errorString: string;
  diagnostic: string;
  context: string;
  sessionState: SessionState;
}

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * SCORM Session Information
 */
export interface ScormSession {
  sessionId: string;
  startTime: Date;
  isInitialized: boolean;
  isTerminated: boolean;
  learnerInfo?: LearnerInfo;
  launchData?: string;
  masteryScore?: number;
}

/**
 * Learner Information
 */
export interface LearnerInfo {
  id: string;
  name: string;
  preferences?: LearnerPreferences;
}

/**
 * Session Data for Persistence
 */
export interface SessionData {
  sessionId: string;
  timestamp: string;
  data: {
    coreData: Record<string, string>;
    interactions: ScormInteraction[];
    objectives: ScormObjective[];
    commentsFromLearner: ScormComment[];
    commentsFromLms: ScormComment[];
  };
  errorState: ErrorState;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * SCORM API Handler Options
 */
export interface ScormApiOptions {
  strictMode?: boolean;
  maxCommitFrequency?: number;
  enableLogging?: boolean;
  validateDataTypes?: boolean;
}

/**
 * LMS Profile Configuration
 */
export interface LmsProfile {
  name: string;
  type: 'generic' | 'litmos' | 'moodle' | 'scorm_cloud';
  features: {
    supportsNavigation?: boolean;
    supportsSequencing?: boolean;
    supportsInteractions?: boolean;
    supportsObjectives?: boolean;
  };
  limits: {
    maxSuspendDataLength?: number;
    maxInteractions?: number;
    maxObjectives?: number;
  };
}

// ============================================================================
// Content Aggregation Model Types
// ============================================================================

/**
 * SCORM Content Types
 */
export type ScormContentType = 'sco' | 'asset';

/**
 * SCORM Application Profiles
 */
export type ApplicationProfile = 'content_aggregation' | 'resource_package';

/**
 * Manifest Resource
 */
export interface ManifestResource {
  identifier: string;
  type: ScormContentType;
  href?: string;
  files: string[];
  dependencies?: string[];
}

/**
 * Manifest Item (Activity)
 */
export interface ManifestItem {
  identifier: string;
  title: string;
  identifierref?: string;
  isvisible?: boolean;
  parameters?: string;
  children?: ManifestItem[];
  sequencing?: SequencingDefinition;
}

// ============================================================================
// Sequencing and Navigation Types
// ============================================================================

/**
 * Sequencing Control Modes
 */
export interface ControlModes {
  choice?: boolean;
  choiceExit?: boolean;
  flow?: boolean;
  forwardOnly?: boolean;
}

/**
 * Sequencing Rule Conditions
 */
export type RuleCondition = 
  | 'satisfied' 
  | 'objectiveStatusKnown' 
  | 'objectiveMeasureKnown'
  | 'completed' 
  | 'activityProgressKnown' 
  | 'attempted'
  | 'attemptLimitExceeded' 
  | 'timeLimitExceeded' 
  | 'outsideAvailableTimeRange';

/**
 * Sequencing Rule Actions
 */
export type RuleAction = 
  | 'skip' 
  | 'disabled' 
  | 'hiddenFromChoice' 
  | 'stopForwardTraversal'
  | 'exitParent' 
  | 'exitAll' 
  | 'retry' 
  | 'retryAll' 
  | 'continue' 
  | 'previous' 
  | 'exit';

/**
 * Sequencing Rule
 */
export interface SequencingRule {
  conditions: {
    condition: RuleCondition;
    operator?: 'and' | 'or';
  }[];
  action: RuleAction;
}

/**
 * Sequencing Definition
 */
export interface SequencingDefinition {
  controlMode?: ControlModes;
  sequencingRules?: {
    preConditionRules?: SequencingRule[];
    postConditionRules?: SequencingRule[];
    exitActionRules?: SequencingRule[];
  };
  limitConditions?: {
    attemptLimit?: number;
    attemptAbsoluteDurationLimit?: string;
  };
  rollupRules?: {
    rollupObjectiveSatisfied?: boolean;
    rollupProgressCompletion?: boolean;
    objectiveMeasureWeight?: number;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * SCORM Data Model Element Access Types
 */
export type AccessType = 'r' | 'w' | 'rw';

/**
 * SCORM Data Model Element Data Types
 */
export type DataModelType = 
  | 'string' 
  | 'boolean' 
  | 'integer' 
  | 'decimal' 
  | 'timeinterval' 
  | 'vocabulary' 
  | 'collection';

/**
 * Data Model Element Schema
 */
export interface DataModelElementSchema {
  access: AccessType;
  type: DataModelType;
  vocabulary?: string[];
  defaultValue?: string | null;
  maxLength?: number;
  range?: {
    min: number;
    max: number;
  };
  description: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * SCORM Event Types
 */
export type ScormEventType = 
  | 'initialize' 
  | 'terminate' 
  | 'getValue' 
  | 'setValue' 
  | 'commit'
  | 'error' 
  | 'stateChange';

/**
 * SCORM Event Data
 */
export interface ScormEvent {
  type: ScormEventType;
  timestamp: string;
  sessionId: string;
  data?: any;
  error?: ErrorState;
}

// ============================================================================
// Testing Types
// ============================================================================

/**
 * SCORM Test Case
 */
export interface ScormTestCase {
  name: string;
  description: string;
  setup?: () => void;
  execute: (api: ScormAPI) => void;
  validate: (api: ScormAPI) => boolean;
  cleanup?: () => void;
}

/**
 * SCORM Compliance Test Result
 */
export interface ComplianceTestResult {
  testName: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  executionTime: number;
}

// ============================================================================
// Module Exports
// ============================================================================

/**
 * Main SCORM API Handler Class Interface
 */
export interface IScormApiHandler extends ScormAPI {
  getApiState(): {
    sessionId: string | null;
    isInitialized: boolean;
    isTerminated: boolean;
    sessionState: SessionState;
    errorState: ErrorState;
    startTime: Date | null;
    commitCount: number;
  };
  reset(): void;
}

/**
 * SCORM Error Handler Interface
 */
export interface IScormErrorHandler {
  setError(errorCode: string | number, diagnostic?: string, context?: string): void;
  getLastError(): string;
  getErrorString(errorCode: string | number): string;
  getDiagnostic(errorCode: string | number): string;
  clearError(): void;
  validateSessionState(requiredState: SessionState, operation?: string): boolean;
  setSessionState(newState: SessionState): void;
  getSessionState(): SessionState;
  hasError(): boolean;
  getErrorHistory(): ErrorHistoryEntry[];
  getErrorState(): ErrorState;
  reset(): void;
}

/**
 * SCORM Data Model Interface
 */
export interface IScormDataModel {
  getValue(element: string): string;
  setValue(element: string, value: string): boolean;
  getAllData(): SessionData['data'];
  reset(): void;
  setLearnerInfo(learnerInfo: LearnerInfo): void;
  setLaunchData(launchData: string): void;
  setMasteryScore(masteryScore: number): void;
  getCompletionStatus(): CompletionStatus;
  getSuccessStatus(): SuccessStatus;
  getScoreInfo(): ScormScore;
}