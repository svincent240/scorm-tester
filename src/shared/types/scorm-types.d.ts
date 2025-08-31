/**
 * SCORM 2004 4th Edition Type Definitions
 * 
 * Comprehensive TypeScript definitions for SCORM compliance.
 * Provides full type safety and IDE support for SCORM development.
 * 
 * @fileoverview SCORM type definitions
 */

// SCORM API Interface
export interface ScormAPI {
  Initialize(parameter: ""): "true" | "false";
  Terminate(parameter: ""): "true" | "false";
  GetValue(element: string): string;
  SetValue(element: string, value: string): "true" | "false";
  Commit(parameter: ""): "true" | "false";
  GetLastError(): string;
  GetErrorString(errorCode: string): string;
  GetDiagnostic(errorCode: string): string;
}

// SCORM 1.2 API Interface
export interface ScormAPI12 {
  LMSInitialize(parameter: ""): "true" | "false";
  LMSFinish(parameter: ""): "true" | "false";
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): "true" | "false";
  LMSCommit(parameter: ""): "true" | "false";
  LMSGetLastError(): string;
  LMSGetErrorString(errorCode: string): string;
  LMSGetDiagnostic(errorCode: string): string;
}

// Data Model Types
export type CompletionStatus = 'completed' | 'incomplete' | 'not attempted' | 'unknown';
export type SuccessStatus = 'passed' | 'failed' | 'unknown';
export type ExitStatus = 'time-out' | 'suspend' | 'logout' | 'normal' | '';
export type EntryStatus = 'ab-initio' | 'resume' | '';
export type CreditStatus = 'credit' | 'no-credit';
export type ModeStatus = 'normal' | 'review' | 'browse';

// Session States
export type SessionState = 'not_initialized' | 'running' | 'terminated';

// Navigation Types
export type NavigationRequest = 
  | 'continue' 
  | 'previous' 
  | 'exit' 
  | 'exitAll' 
  | 'abandon' 
  | 'abandonAll' 
  | 'suspendAll' 
  | 'start' 
  | 'resume'
  | `choice.{target=${string}}`;

// Interaction Types
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

export type InteractionResult = 'correct' | 'incorrect' | 'unanticipated' | 'neutral';

// SCORM Data Model Interface
export interface ScormDataModel {
  // Core elements
  'cmi.completion_status': CompletionStatus;
  'cmi.success_status': SuccessStatus;
  'cmi.exit': ExitStatus;
  'cmi.entry': EntryStatus;
  'cmi.location': string;
  'cmi.progress_measure': number;
  
  // Scoring
  'cmi.score.scaled': number;
  'cmi.score.raw': number;
  'cmi.score.min': number;
  'cmi.score.max': number;
  'cmi.scaled_passing_score': number;
  
  // Time
  'cmi.session_time': string;
  'cmi.total_time': string;
  
  // Suspend data
  'cmi.suspend_data': string;
  
  // Learner info
  'cmi.learner_id': string;
  'cmi.learner_name': string;
  'cmi.credit': CreditStatus;
  'cmi.mode': ModeStatus;
  'cmi.launch_data': string;
  
  // Collections
  'cmi.interactions._count': number;
  'cmi.objectives._count': number;
  
  // Navigation
  'adl.nav.request': NavigationRequest;
}

// Error Types
export interface ScormError {
  code: number;
  message: string;
  diagnostic?: string;
  category: 'SUCCESS' | 'GENERAL' | 'SYNTAX' | 'DATA_MODEL';
}

// Manifest Types
export interface ScormManifest {
  identifier: string;
  version?: string;
  metadata: ManifestMetadata;
  organizations: Organization[];
  resources: Resource[];
  sequencingCollection?: SequencingCollection;
  packageType: 'content_aggregation' | 'resource';
}

export interface ManifestMetadata {
  schema: string;
  schemaversion: string;
  lom?: LearningObjectMetadata;
}

export interface LearningObjectMetadata {
  general?: {
    identifier?: string;
    title?: string;
    language?: string;
    description?: string;
    keyword?: string[];
  };
  lifecycle?: {
    version?: string;
    status?: string;
  };
  technical?: {
    format?: string[];
    size?: number;
    location?: string;
    requirement?: TechnicalRequirement[];
  };
  educational?: {
    interactivityType?: string;
    learningResourceType?: string[];
    interactivityLevel?: string;
    semanticDensity?: string;
    intendedEndUserRole?: string[];
    context?: string[];
    typicalAgeRange?: string[];
    difficulty?: string;
    typicalLearningTime?: string;
    description?: string;
    language?: string[];
  };
}

export interface TechnicalRequirement {
  orComposite: {
    type: string;
    name: string;
    minimumVersion?: string;
    maximumVersion?: string;
  }[];
}

export interface Organization {
  identifier: string;
  title: string;
  items: Item[];
  sequencing?: SequencingDefinition;
  metadata?: OrganizationMetadata;
}

export interface OrganizationMetadata {
  lom?: LearningObjectMetadata;
}

export interface Item {
  identifier: string;
  identifierref?: string;
  title: string;
  isvisible?: boolean;
  parameters?: string;
  children: Item[];
  sequencing?: SequencingDefinition;
  metadata?: ItemMetadata;
  timeLimitAction?: 'exit,message' | 'exit,no message' | 'continue,message' | 'continue,no message';
  dataFromLMS?: string;
  completionThreshold?: number;
}

export interface ItemMetadata {
  lom?: LearningObjectMetadata;
  adlcp?: {
    timeLimitAction?: string;
    dataFromLMS?: string;
    completionThreshold?: string;
  };
}

export interface Resource {
  identifier: string;
  type: string;
  scormType: 'sco' | 'asset';
  href?: string;
  files: ResourceFile[];
  dependencies: Dependency[];
  metadata?: ResourceMetadata;
}

export interface ResourceFile {
  href: string;
  metadata?: FileMetadata;
}

export interface FileMetadata {
  lom?: LearningObjectMetadata;
}

export interface Dependency {
  identifierref: string;
}

export interface ResourceMetadata {
  lom?: LearningObjectMetadata;
  adlcp?: {
    scormType?: string;
  };
}

// Sequencing Types
export interface SequencingCollection {
  sequencing: SequencingDefinition[];
}

export interface SequencingDefinition {
  id?: string;
  controlMode?: ControlMode;
  sequencingRules?: SequencingRules;
  limitConditions?: LimitConditions;
  auxiliaryResources?: AuxiliaryResource[];
  rollupRules?: RollupRules;
  objectives?: Objective[];
  randomizationControls?: RandomizationControls;
  deliveryControls?: DeliveryControls;
  constrainedChoiceConsiderations?: ConstrainedChoiceConsiderations;
  rollupConsiderations?: RollupConsiderations;
}

export interface ControlMode {
  choice?: boolean;
  choiceExit?: boolean;
  flow?: boolean;
  forwardOnly?: boolean;
  useCurrentAttemptObjectiveInfo?: boolean;
  useCurrentAttemptProgressInfo?: boolean;
}

export interface SequencingRules {
  preConditionRule?: PreConditionRule[];
  exitConditionRule?: ExitConditionRule[];
  postConditionRule?: PostConditionRule[];
}

export interface PreConditionRule {
  ruleConditions: RuleConditions;
  ruleAction: 'skip' | 'disabled' | 'hiddenFromChoice' | 'stopForwardTraversal';
}

export interface ExitConditionRule {
  ruleConditions: RuleConditions;
  ruleAction: 'exit';
}

export interface PostConditionRule {
  ruleConditions: RuleConditions;
  ruleAction: 'exitParent' | 'exitAll' | 'retry' | 'retryAll' | 'continue' | 'previous';
}

export interface RuleConditions {
  conditionCombination: 'all' | 'any';
  ruleCondition: RuleCondition[];
}

export interface RuleCondition {
  referencedObjective?: string;
  measureThreshold?: number;
  operator: 'noOp' | 'satisfied' | 'objectiveStatusKnown' | 'objectiveMeasureKnown' | 'objectiveMeasureGreaterThan' | 'objectiveMeasureLessThan' | 'completed' | 'activityProgressKnown' | 'attempted' | 'attemptLimitExceeded' | 'timeLimitExceeded' | 'outsideAvailableTimeRange';
}

export interface LimitConditions {
  attemptLimit?: number;
  attemptAbsoluteDurationLimit?: string;
  attemptExperiencedDurationLimit?: string;
  activityAbsoluteDurationLimit?: string;
  activityExperiencedDurationLimit?: string;
  beginTimeLimit?: string;
  endTimeLimit?: string;
}

export interface AuxiliaryResource {
  id: string;
  purpose: 'suspendAll' | 'exitAll' | 'abandon' | 'abandonAll';
  resourceIdentifier: string;
}

export interface RollupRules {
  rollupRule: RollupRule[];
}

export interface RollupRule {
  childActivitySet?: string;
  minimumCount?: number;
  minimumPercent?: number;
  ruleConditions: RuleConditions;
  ruleAction: RollupAction;
}

export interface RollupAction {
  action: 'satisfied' | 'notSatisfied' | 'completed' | 'incomplete';
}

export interface Objective {
  objectiveID: string;
  satisfiedByMeasure?: boolean;
  minNormalizedMeasure?: number;
  mapInfo?: MapInfo[];
}

export interface MapInfo {
  targetObjectiveID: string;
  readSatisfiedStatus?: boolean;
  readNormalizedMeasure?: boolean;
  writeSatisfiedStatus?: boolean;
  writeNormalizedMeasure?: boolean;
}

export interface RandomizationControls {
  randomizationTiming?: 'never' | 'once' | 'onEachNewAttempt';
  selectCount?: number;
  reorderChildren?: boolean;
  selectionTiming?: 'never' | 'once' | 'onEachNewAttempt';
}

export interface DeliveryControls {
  tracked?: boolean;
  completionSetByContent?: boolean;
  objectiveSetByContent?: boolean;
}

export interface ConstrainedChoiceConsiderations {
  preventActivation?: boolean;
  constrainChoice?: boolean;
}

export interface RollupConsiderations {
  requiredForSatisfied?: 'always' | 'ifAttempted' | 'ifNotSkipped' | 'ifNotSuspended';
  requiredForNotSatisfied?: 'always' | 'ifAttempted' | 'ifNotSkipped' | 'ifNotSuspended';
  requiredForCompleted?: 'always' | 'ifAttempted' | 'ifNotSkipped' | 'ifNotSuspended';
  requiredForIncomplete?: 'always' | 'ifAttempted' | 'ifNotSkipped' | 'ifNotSuspended';
  measureSatisfactionIfActive?: boolean;
}

// Activity Tree Types
export interface Activity {
  identifier: string;
  title: string;
  type: 'cluster' | 'leaf';
  parent: Activity | null;
  children: Activity[];
  
  // Tracking data
  completionStatus: CompletionStatus;
  successStatus: SuccessStatus;
  attemptCount: number;
  progressMeasure?: number;
  
  // Sequencing data
  sequencing: SequencingDefinition;
  objectives: Objective[];
  
  // Runtime state
  isActive: boolean;
  isSuspended: boolean;
  isAvailable: boolean;
  isVisible: boolean;
  
  // Attempt data
  attemptAbsoluteDuration?: number;
  attemptExperiencedDuration?: number;
  activityAbsoluteDuration?: number;
  activityExperiencedDuration?: number;
  
  // Limit conditions
  attemptLimit?: number;
  beginTimeLimit?: Date;
  endTimeLimit?: Date;
}

// Validation Types
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  packageType?: 'content_aggregation' | 'resource';
  scormVersion?: string;
}

export interface ValidationError {
  code: string;
  message: string;
  element?: string;
  line?: number;
  severity: 'error';
}

export interface ValidationWarning {
  code: string;
  message: string;
  element?: string;
  suggestion?: string;
  severity: 'warning';
}

// Course Information Types
export interface CourseInfo {
  title: string;
  version: string;
  scormVersion: string;
  packageType: 'content_aggregation' | 'resource';
  courseStructure: CourseStructure;
  entryPoint: string | null;
  launchUrl: string;
  metadata?: ManifestMetadata;
}

export interface CourseStructure {
  isFlowOnly: boolean;
  items: CourseItem[];
  totalItems: number;
  completedItems: number;
}

export interface CourseItem {
  id: string;
  identifier: string;
  title: string;
  type: 'sco' | 'asset' | 'cluster';
  isVisible: boolean;
  completed: boolean;
  active: boolean;
  children?: CourseItem[];
  identifierref?: string;
  parameters?: string;
}

// Session Types
export interface SessionData {
  id: string;
  startTime: number;
  endTime?: number;
  connected: boolean;
  courseInfo?: CourseInfo;
  dataModel: Partial<ScormDataModel>;
  apiCallHistory: ApiCall[];
}

export interface ApiCall {
  id: string;
  timestamp: number;
  method: string;
  parameters: string[];
  result: string;
  errorCode: string;
  duration?: number;
}

// Progress Types
export interface ProgressData {
  completionStatus: CompletionStatus;
  successStatus: SuccessStatus;
  scoreRaw?: number;
  scoreScaled?: number;
  scoreMin?: number;
  scoreMax?: number;
  progressMeasure: number;
  sessionTime: string;
  totalTime: string;
  location?: string;
  suspendData?: string;
}

// Navigation Types
export interface NavigationState {
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  currentItem?: string;
  isFlowOnly: boolean;
  menuVisible: boolean;
}

// LMS Profile Types
export interface LmsProfile {
  id: string;
  name: string;
  description: string;
  constraints: LmsConstraints;
  features: LmsFeatures;
}

export interface LmsConstraints {
  suspendDataLimit: number;
  stringLimit: number;
  decimalPlaces: number;
  timeoutDuration: number;
}

export interface LmsFeatures {
  strictValidation: boolean;
  supportsSuspendData: boolean;
  supportsBookmarking: boolean;
  supportsSequencing: boolean;
  supportsObjectives: boolean;
  supportsInteractions: boolean;
}

// Test Scenario Types
export interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
}

export interface TestStep {
  action: 'setValue' | 'getValue' | 'commit' | 'wait' | 'navigate';
  element?: string;
  value?: string;
  duration?: number;
  expected?: string;
}

// Component Types
export interface ComponentOptions {
  autoRender?: boolean;
  className?: string;
  attributes?: Record<string, string>;
  events?: Record<string, string | Function>;
  template?: string;
  parent?: string | HTMLElement;
}

export interface ComponentStatus {
  elementId: string;
  isInitialized: boolean;
  isDestroyed: boolean;
  isVisible: boolean;
  childCount: number;
  eventListenerCount: number;
}

// Event Types
export interface EventData {
  component?: string;
  elementId?: string;
  data?: any;
  timestamp?: number;
}

export interface ScormEvent extends EventData {
  sessionId?: string;
  element?: string;
  value?: any;
  errorCode?: string;
}

// UI State Types
export interface UIState {
  currentSession: string | null;
  sessionStartTime: number | null;
  isConnected: boolean;
  courseInfo: CourseInfo | null;
  courseStructure: CourseStructure | null;
  currentCoursePath: string | null;
  entryPoint: string | null;
  navigationState: NavigationState;
  progressData: ProgressData;
  ui: UISettings;
  lmsProfile: string | null;
  networkDelay: number;
  apiCallHistory: ApiCall[];
  maxApiCallHistory: number;
}

export interface UISettings {
  theme: 'default' | 'dark' | 'high-contrast';
  debugPanelVisible: boolean;
  sidebarCollapsed: boolean;
  courseOutlineVisible: boolean;
  devModeEnabled: boolean;
  loading: boolean;
  loadingMessage?: string;
  error: ErrorInfo | null;
  notifications: Notification[];
}

export interface ErrorInfo {
  message: string;
  timestamp: number;
  stack?: string;
}

export interface Notification {
  id: string | number;
  type: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
  duration: number;
  timestamp: number;
}

// Global Window Extensions
declare global {
  interface Window {
    API?: ScormAPI12;
    API_1484_11?: ScormAPI;
    scormApp?: any;
    electronAPI?: any;
  }
}

export {};
