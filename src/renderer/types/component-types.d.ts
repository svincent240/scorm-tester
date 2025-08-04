/**
 * Component Type Definitions
 * 
 * TypeScript definitions for renderer components and UI elements.
 * Provides type safety for component development and integration.
 * 
 * @fileoverview Component type definitions
 */

import { ScormAPI, ScormAPI12, ScormDataModel, CourseInfo, ProgressData, NavigationState, ApiCall } from '../../shared/types/scorm-types';

// Base Component Types
export interface ComponentConfig {
  elementId: string;
  className?: string;
  attributes?: Record<string, string>;
  events?: Record<string, EventListener>;
  autoRender?: boolean;
  parent?: string | HTMLElement;
}

export interface ComponentState {
  isInitialized: boolean;
  isDestroyed: boolean;
  isVisible: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export abstract class BaseComponent {
  protected elementId: string;
  protected element: HTMLElement | null;
  protected state: ComponentState;
  protected config: ComponentConfig;
  
  constructor(config: ComponentConfig);
  
  abstract render(): void;
  abstract destroy(): void;
  
  protected createElement(): HTMLElement;
  protected bindEvents(): void;
  protected unbindEvents(): void;
  protected show(): void;
  protected hide(): void;
  protected setError(message: string): void;
  protected clearError(): void;
  protected emit(eventName: string, data?: any): void;
  protected on(eventName: string, handler: EventListener): void;
  protected off(eventName: string, handler: EventListener): void;
}

// Event Bus Types
export interface EventBusConfig {
  maxListeners?: number;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface EventListener {
  (data?: any): void;
}

export interface EventSubscription {
  eventName: string;
  listener: EventListener;
  once: boolean;
  priority: number;
}

export class EventBus {
  constructor(config?: EventBusConfig);
  
  on(eventName: string, listener: EventListener, priority?: number): void;
  once(eventName: string, listener: EventListener, priority?: number): void;
  off(eventName: string, listener?: EventListener): void;
  emit(eventName: string, data?: any): void;
  clear(): void;
  getListenerCount(eventName?: string): number;
  getEventNames(): string[];
}

// UI State Management Types
export interface UIStateConfig {
  persistKey?: string;
  autoSave?: boolean;
  saveInterval?: number;
  enableHistory?: boolean;
  maxHistorySize?: number;
}

export interface StateChange<T = any> {
  path: string;
  oldValue: T;
  newValue: T;
  timestamp: number;
}

export interface StateSnapshot {
  state: any;
  timestamp: number;
  version: string;
}

export class UIStateManager {
  constructor(config?: UIStateConfig);
  
  get<T = any>(path: string, defaultValue?: T): T;
  set<T = any>(path: string, value: T): void;
  update<T = any>(path: string, updater: (current: T) => T): void;
  delete(path: string): void;
  reset(): void;
  
  subscribe<T = any>(path: string, callback: (value: T, change: StateChange<T>) => void): () => void;
  unsubscribe(path: string, callback?: Function): void;
  
  save(): void;
  load(): void;
  
  createSnapshot(): StateSnapshot;
  restoreSnapshot(snapshot: StateSnapshot): void;
  
  getHistory(): StateChange[];
  clearHistory(): void;
}

// SCORM Client Types
export interface ScormClientConfig {
  apiVersion?: '1.2' | '2004';
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableLogging?: boolean;
  strictMode?: boolean;
}

export interface ScormClientState {
  isInitialized: boolean;
  isTerminated: boolean;
  apiVersion: '1.2' | '2004' | null;
  lastError: string;
  sessionStartTime: number | null;
  callCount: number;
}

export interface ScormCallResult {
  success: boolean;
  value?: string;
  errorCode: string;
  errorMessage?: string;
  duration: number;
  timestamp: number;
}

export class ScormClient {
  constructor(config?: ScormClientConfig);
  
  initialize(): Promise<boolean>;
  terminate(): Promise<boolean>;
  getValue(element: string): Promise<string>;
  setValue(element: string, value: string): Promise<boolean>;
  commit(): Promise<boolean>;
  
  getLastError(): string;
  getErrorString(errorCode: string): string;
  getDiagnostic(errorCode: string): string;
  
  isInitialized(): boolean;
  isTerminated(): boolean;
  getApiVersion(): '1.2' | '2004' | null;
  getState(): ScormClientState;
  getCallHistory(): ApiCall[];
  
  on(event: string, listener: EventListener): void;
  off(event: string, listener?: EventListener): void;
}

// Content Viewer Types
export interface ContentViewerConfig extends ComponentConfig {
  allowFullscreen?: boolean;
  enableSandbox?: boolean;
  sandboxPermissions?: string[];
  loadTimeout?: number;
  enableNavigation?: boolean;
  showLoadingIndicator?: boolean;
}

export interface ContentViewerState extends ComponentState {
  isLoading: boolean;
  isLoaded: boolean;
  currentUrl?: string;
  loadProgress: number;
  hasNavigationControls: boolean;
}

export interface ContentLoadEvent {
  url: string;
  success: boolean;
  duration: number;
  error?: string;
}

export abstract class ContentViewer extends BaseComponent {
  constructor(config: ContentViewerConfig);
  
  abstract loadContent(url: string): Promise<void>;
  abstract reload(): Promise<void>;
  abstract goBack(): void;
  abstract goForward(): void;
  abstract stop(): void;
  
  abstract enableFullscreen(): void;
  abstract exitFullscreen(): void;
  abstract isFullscreen(): boolean;
  
  abstract getState(): ContentViewerState;
  abstract getCurrentUrl(): string | null;
  abstract canGoBack(): boolean;
  abstract canGoForward(): boolean;
}

// Navigation Controls Types
export interface NavigationControlsConfig extends ComponentConfig {
  showPrevious?: boolean;
  showNext?: boolean;
  showMenu?: boolean;
  showExit?: boolean;
  enableKeyboardShortcuts?: boolean;
  customButtons?: NavigationButton[];
}

export interface NavigationButton {
  id: string;
  label: string;
  icon?: string;
  action: string | (() => void);
  enabled?: boolean;
  visible?: boolean;
  tooltip?: string;
  className?: string;
}

export interface NavigationControlsState extends ComponentState {
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  menuVisible: boolean;
  activeButton?: string;
}

export abstract class NavigationControls extends BaseComponent {
  constructor(config: NavigationControlsConfig);
  
  abstract updateState(navigationState: NavigationState): void;
  abstract enableButton(buttonId: string): void;
  abstract disableButton(buttonId: string): void;
  abstract showButton(buttonId: string): void;
  abstract hideButton(buttonId: string): void;
  
  abstract addCustomButton(button: NavigationButton): void;
  abstract removeCustomButton(buttonId: string): void;
  abstract updateCustomButton(buttonId: string, updates: Partial<NavigationButton>): void;
  
  abstract getState(): NavigationControlsState;
}

// Progress Tracking Types
export interface ProgressTrackingConfig extends ComponentConfig {
  showPercentage?: boolean;
  showTimeSpent?: boolean;
  showScore?: boolean;
  showCompletion?: boolean;
  animateChanges?: boolean;
  updateInterval?: number;
}

export interface ProgressTrackingState extends ComponentState {
  progressPercentage: number;
  completionStatus: string;
  successStatus: string;
  scoreRaw?: number;
  scoreScaled?: number;
  timeSpent: string;
  totalTime: string;
}

export abstract class ProgressTracking extends BaseComponent {
  constructor(config: ProgressTrackingConfig);
  
  abstract updateProgress(progressData: ProgressData): void;
  abstract reset(): void;
  
  abstract getProgressPercentage(): number;
  abstract getTimeSpent(): string;
  abstract getScore(): { raw?: number; scaled?: number; min?: number; max?: number };
  
  abstract getState(): ProgressTrackingState;
}

// Debug Panel Types
export interface DebugPanelConfig extends ComponentConfig {
  maxApiCalls?: number;
  showTimestamps?: boolean;
  showDuration?: boolean;
  enableFiltering?: boolean;
  enableExport?: boolean;
  refreshInterval?: number;
}

export interface DebugPanelState extends ComponentState {
  isExpanded: boolean;
  activeTab: 'api-calls' | 'data-model' | 'session' | 'errors';
  filterText: string;
  apiCallCount: number;
  errorCount: number;
}

export interface DebugApiCall extends ApiCall {
  formatted: string;
  category: 'get' | 'set' | 'control' | 'error';
}

export abstract class DebugPanel extends BaseComponent {
  constructor(config: DebugPanelConfig);
  
  abstract addApiCall(call: ApiCall): void;
  abstract clearApiCalls(): void;
  abstract updateDataModel(dataModel: Partial<ScormDataModel>): void;
  abstract updateSessionInfo(sessionInfo: any): void;
  
  abstract expand(): void;
  abstract collapse(): void;
  abstract toggle(): void;
  
  abstract setActiveTab(tab: 'api-calls' | 'data-model' | 'session' | 'errors'): void;
  abstract setFilter(filterText: string): void;
  
  abstract exportData(format: 'json' | 'csv' | 'txt'): string;
  
  abstract getState(): DebugPanelState;
  abstract getFilteredApiCalls(): DebugApiCall[];
}

// Course Outline Types
export interface CourseOutlineConfig extends ComponentConfig {
  showProgress?: boolean;
  showIcons?: boolean;
  enableNavigation?: boolean;
  expandByDefault?: boolean;
  maxDepth?: number;
}

export interface CourseOutlineState extends ComponentState {
  isExpanded: boolean;
  selectedItemId?: string;
  expandedItems: Set<string>;
  courseStructure?: any;
}

export interface CourseOutlineItem {
  id: string;
  title: string;
  type: 'sco' | 'asset' | 'cluster';
  level: number;
  isVisible: boolean;
  isCompleted: boolean;
  isActive: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  children: CourseOutlineItem[];
}

export abstract class CourseOutline extends BaseComponent {
  constructor(config: CourseOutlineConfig);
  
  abstract updateCourseStructure(courseInfo: CourseInfo): void;
  abstract selectItem(itemId: string): void;
  abstract expandItem(itemId: string): void;
  abstract collapseItem(itemId: string): void;
  abstract toggleItem(itemId: string): void;
  
  abstract expandAll(): void;
  abstract collapseAll(): void;
  
  abstract getState(): CourseOutlineState;
  abstract getSelectedItem(): CourseOutlineItem | null;
  abstract getExpandedItems(): string[];
}

// Theme Manager Types
export interface ThemeConfig {
  defaultTheme?: string;
  availableThemes?: string[];
  enableSystemTheme?: boolean;
  persistTheme?: boolean;
  customProperties?: Record<string, string>;
}

export interface ThemeState {
  currentTheme: string;
  systemTheme?: string;
  availableThemes: string[];
  customProperties: Record<string, string>;
}

export class ThemeManager {
  constructor(config?: ThemeConfig);
  
  setTheme(themeName: string): void;
  getTheme(): string;
  getAvailableThemes(): string[];
  
  setCustomProperty(property: string, value: string): void;
  getCustomProperty(property: string): string | null;
  removeCustomProperty(property: string): void;
  
  enableSystemTheme(): void;
  disableSystemTheme(): void;
  isSystemThemeEnabled(): boolean;
  
  getState(): ThemeState;
  
  on(event: 'theme-changed', listener: (theme: string) => void): void;
  off(event: 'theme-changed', listener?: (theme: string) => void): void;
}

// Notification Manager Types
export interface NotificationConfig {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  maxNotifications?: number;
  defaultDuration?: number;
  enableSound?: boolean;
  enableAnimation?: boolean;
}

export interface NotificationOptions {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  duration?: number;
  persistent?: boolean;
  actions?: NotificationAction[];
  icon?: string;
  sound?: boolean;
}

export interface NotificationAction {
  label: string;
  action: () => void;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
  duration: number;
  persistent: boolean;
  timestamp: number;
  actions: NotificationAction[];
  icon?: string;
}

export class NotificationManager {
  constructor(config?: NotificationConfig);
  
  show(message: string, options?: NotificationOptions): string;
  info(message: string, options?: Omit<NotificationOptions, 'type'>): string;
  success(message: string, options?: Omit<NotificationOptions, 'type'>): string;
  warning(message: string, options?: Omit<NotificationOptions, 'type'>): string;
  error(message: string, options?: Omit<NotificationOptions, 'type'>): string;
  
  hide(id: string): void;
  hideAll(): void;
  
  getNotifications(): NotificationItem[];
  getNotificationCount(): number;
  
  on(event: 'notification-shown' | 'notification-hidden', listener: (notification: NotificationItem) => void): void;
  off(event: 'notification-shown' | 'notification-hidden', listener?: (notification: NotificationItem) => void): void;
}

// Application Types
export interface AppConfig {
  elementId?: string;
  enableDebugMode?: boolean;
  theme?: string;
  autoStart?: boolean;
  components?: {
    contentViewer?: ContentViewerConfig;
    navigationControls?: NavigationControlsConfig;
    progressTracking?: ProgressTrackingConfig;
    debugPanel?: DebugPanelConfig;
    courseOutline?: CourseOutlineConfig;
  };
  services?: {
    eventBus?: EventBusConfig;
    uiState?: UIStateConfig;
    scormClient?: ScormClientConfig;
    theme?: ThemeConfig;
    notifications?: NotificationConfig;
  };
}

export interface AppState {
  isInitialized: boolean;
  isStarted: boolean;
  hasError: boolean;
  errorMessage?: string;
  components: Record<string, BaseComponent>;
  services: Record<string, any>;
}

export class ScormTesterApp {
  constructor(config?: AppConfig);
  
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  
  getComponent<T extends BaseComponent>(name: string): T | null;
  getService<T>(name: string): T | null;
  
  loadCourse(coursePath: string): Promise<void>;
  unloadCourse(): void;
  
  getState(): AppState;
  
  on(event: string, listener: EventListener): void;
  off(event: string, listener?: EventListener): void;
}

// Utility Types
export interface DOMUtils {
  createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    attributes?: Record<string, string>,
    children?: (string | HTMLElement)[]
  ): HTMLElementTagNameMap[K];
  
  addClass(element: HTMLElement, className: string): void;
  removeClass(element: HTMLElement, className: string): void;
  toggleClass(element: HTMLElement, className: string): void;
  hasClass(element: HTMLElement, className: string): boolean;
  
  show(element: HTMLElement): void;
  hide(element: HTMLElement): void;
  toggle(element: HTMLElement): void;
  isVisible(element: HTMLElement): boolean;
  
  on(element: HTMLElement, event: string, handler: EventListener): void;
  off(element: HTMLElement, event: string, handler: EventListener): void;
  trigger(element: HTMLElement, event: string, data?: any): void;
  
  closest(element: HTMLElement, selector: string): HTMLElement | null;
  find(element: HTMLElement, selector: string): HTMLElement | null;
  findAll(element: HTMLElement, selector: string): HTMLElement[];
}

export interface TimeUtils {
  formatDuration(seconds: number): string;
  parseDuration(duration: string): number;
  formatTimestamp(timestamp: number): string;
  getCurrentTimestamp(): number;
  addTime(time1: string, time2: string): string;
  subtractTime(time1: string, time2: string): string;
}

export interface ValidationUtils {
  isValidScormTime(time: string): boolean;
  isValidScormDecimal(value: string, min?: number, max?: number): boolean;
  isValidScormString(value: string, maxLength?: number): boolean;
  isValidScormIdentifier(identifier: string): boolean;
  validateDataModelElement(element: string, value: string): boolean;
}

// Global Type Augmentations
declare global {
  interface Window {
    scormTesterApp?: ScormTesterApp;
    domUtils?: DOMUtils;
    timeUtils?: TimeUtils;
    validationUtils?: ValidationUtils;
  }
}

export {};