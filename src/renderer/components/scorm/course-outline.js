// @ts-check

/**
 * Course Outline Component
 *
 * Displays hierarchical course structure with navigation,
 * progress indicators, and expandable tree view.
 *
 * @fileoverview SCORM course outline component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { rendererLogger } from '../../utils/renderer-logger.js';
// sn-bridge is provided via dependency injection (options.snBridge). No direct import here.
import { escapeHTML } from '../../utils/escape.js';


/**
 * Course Outline Class
 */
class CourseOutline extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);

    this.courseStructure = null;
    this.currentItem = null;
    this.expandedItems = new Set();
    this.progressData = new Map();
    this.scormStates = new Map(); // Store comprehensive SCORM states
    this.availableNavigation = []; // Store available navigation from SN service
    this.browseModeEnabled = false;
    this.scormStatesLoaded = false; // Track whether SCORM states have been loaded

    // Injected SN bridge (renderer↔main IPC); provide via options in tests
    this.snBridge = options.snBridge || null;

    // Bind handlers to preserve 'this' context across event bus calls
    this.handleCourseLoaded = this.handleCourseLoaded.bind(this);
    this.handleCourseCleared = this.handleCourseCleared.bind(this);
    this.handleNavigationUpdated = this.handleNavigationUpdated.bind(this);
    this.handleProgressUpdated = this.handleProgressUpdated.bind(this);
    this.handleScormDataChanged = this.handleScormDataChanged.bind(this);

    // Bind UI callbacks
    this.expandAll = this.expandAll.bind(this);
    this.collapseAll = this.collapseAll.bind(this);
    this.toggleItem = this.toggleItem.bind(this);
    this.navigateToItem = this.navigateToItem.bind(this);

    rendererLogger.info('CourseOutline: constructor initialized');


  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'course-outline',
      showProgress: true,
      showIcons: true,
      enableNavigation: true,
      attributes: { 'data-component': 'course-outline' }
    };
  }




  async setup() {
    this.uiState = await uiStatePromise; // Resolve the promise
    rendererLogger.info('CourseOutline.setup: uiState resolved');

    // Ensure our event subscriptions are established before any initial render,
    // to avoid a double-render race between initial state read and course:loaded event.
    try {
      this.setupEventSubscriptions?.();
    } catch (e) {
      try { rendererLogger.error('CourseOutline.setup: setupEventSubscriptions failed', e?.message || e); } catch (_) {}
    }

    // After subscriptions are in place, if a course is already present in state,
    // emit a synthetic 'course:loaded' so we take the same code path as normal loads.
    try {
      const existingStructure = this.uiState.getState('courseStructure');
      const existingInfo = this.uiState.getState('courseInfo');
      if (existingStructure && Array.isArray(existingStructure.items)) {
        try { rendererLogger.info('CourseOutline.setup: emitting synthetic course:loaded for existing state'); } catch (_) {}
        const { eventBus } = await import('../../services/event-bus.js');
        eventBus.emit('course:loaded', { info: existingInfo || null, structure: existingStructure });
      } else {
        // No existing course; render empty state once
        this.renderContent();
        this.showEmptyState();
      }
    } catch (e) {
      try { rendererLogger.error('CourseOutline.setup: initial state check failed', e?.message || e); } catch (_) {}
      // Fallback to rendering base content to ensure component mounts
      this.renderContent();
      this.showEmptyState();
    }

    // DEBUG: Log initial state for investigation
    rendererLogger.info('CourseOutline.setup: Initial component state', {
      hasScormStates: this.scormStates.size > 0,
      scormStatesLoaded: this.scormStatesLoaded,
      availableNavigation: this.availableNavigation,
      browseModeEnabled: this.browseModeEnabled,
      courseStructureItems: this.courseStructure?.items?.length || 0
    });
  }

  renderContent() {
    // Create course outline HTML structure if it doesn't exist
    if (!this.element.querySelector('.course-outline__container')) {
      this.element.innerHTML = `
        <div class="course-outline__container">
          <div class="course-outline__header">
            <h3>Course Structure</h3>
            <div class="course-outline__controls">
              <button class="outline-btn outline-btn--expand" title="Expand All">⊞</button>
              <button class="outline-btn outline-btn--collapse" title="Collapse All">⊟</button>
            </div>
          </div>

          <div class="course-outline__content">
            <div class="course-outline__empty">
              <div class="empty-state">
                <div class="empty-state__icon">📚</div>
                <div class="empty-state__title">No Course Loaded</div>
                <div class="empty-state__message">Load a SCORM course to view its structure</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    this.contentArea = this.element.querySelector('.course-outline__content');
    this.expandAllBtn = this.element.querySelector('.outline-btn--expand');
    this.collapseAllBtn = this.element.querySelector('.outline-btn--collapse');

    try { rendererLogger.info('CourseOutline: HTML structure created successfully'); } catch (_) {}
  }

  setupEventSubscriptions() {
    // Ensure we pass bound handlers to avoid 'this' loss
    // Dedupe course:loaded handling — ignore identical payloads within a small window
    this._lastCourseLoadedSig = null;
    this._lastCourseLoadedAt = 0;
    this._COURSE_LOADED_DEDUPE_MS = 500;

    this.subscribe('course:loaded', (data) => {
      const now = Date.now();
      // Create a small signature from payload to detect duplicates
      let sig = 'none';
      try {
        const payload = (data && data.data) ? data.data : data;
        const s = payload?.structure;
        const m = payload?.manifest;
        sig = JSON.stringify({
          t: payload?.title || payload?.courseTitle || '',
          ic: Array.isArray(s?.items) ? s.items.length : 0,
          mi: m?.identifier || null
        });
      } catch (_) {}

      if (this._lastCourseLoadedSig === sig && (now - this._lastCourseLoadedAt) < this._COURSE_LOADED_DEDUPE_MS) {
        try { rendererLogger.debug('CourseOutline: duplicate course:loaded ignored'); } catch (_) {}
        return;
      }
      this._lastCourseLoadedSig = sig;
      this._lastCourseLoadedAt = now;

      rendererLogger.info('CourseOutline: event course:loaded received');
      this.handleCourseLoaded(data);
    });

    this.subscribe('course:cleared', (data) => {
      rendererLogger.info('CourseOutline: event course:cleared received');
      this.handleCourseCleared(data);
    });
    this.subscribe('navigation:updated', (data) => {
      rendererLogger.debug('CourseOutline: event navigation:updated', data);
      this.handleNavigationUpdated(data);
    });
    this.subscribe('progress:updated', (data) => {
      this.handleProgressUpdated(data);
    });
    // Removed duplicate ui:scorm:dataChanged subscription - handled below with proper filtering

    // Listen for navigation launch events to update current item highlighting
    this.subscribe('navigation:launch', (data) => {
      rendererLogger.debug('CourseOutline: event navigation:launch', data);
      this.handleNavigationLaunch(data);
    });

    // BUG-022 FIX: Subscribe to navigation state updates
    this.subscribe('navigation:state:updated', (stateData) => {
      this.handleNavigationStateUpdate(stateData);
    });

    // Listen for browse mode changes (unified event naming)
    this.subscribe('browseMode:changed', (data) => {
      rendererLogger.info('CourseOutline: Browse mode changed event received', data);
      this.handleBrowseModeChanged({ enabled: !!data?.enabled, ...data });
    });


    // Listen for SN service initialization to fetch SCORM states
    this.subscribe('sn:initialized', () => {
      rendererLogger.info('CourseOutline: SN service initialized event received', {
        alreadyLoaded: this.scormStatesLoaded,
        hasStates: this.scormStates.size > 0,
        hasCourseStructure: !!this.courseStructure,
        courseStructureItems: this.courseStructure?.items?.length || 0
      });

      // Only fetch if we don't already have states loaded
      if (!this.scormStatesLoaded) {
        rendererLogger.info('CourseOutline: Fetching SCORM states after SN initialization');
        this.fetchScormStates().then(() => {
          if (this.courseStructure) {
            rendererLogger.info('CourseOutline: Re-rendering course structure with new SCORM states');
            this.renderCourseStructure(); // Re-render with SCORM states
          }
          rendererLogger.info('CourseOutline: SCORM states updated after SN initialization');
        }).catch(error => {
          rendererLogger.warn('CourseOutline: Failed to fetch SCORM states after SN init', {
            error: error?.message || error
          });
        });
      } else {
        rendererLogger.debug('CourseOutline: SCORM states already loaded, skipping SN init fetch');
      }
    });

    // Listen for SCORM data changes that affect validation
    this.subscribe('ui:scorm:dataChanged', (data) => {
      const element = data?.data?.element || data?.element;
      // Only refresh on key data changes that affect sequencing
      if (element && (
        element.includes('completion_status') ||
        element.includes('success_status') ||
        element.includes('objectives') ||
        element.includes('progress_measure')
      )) {
        // For completion/success status changes, refresh immediately without debounce
        if (element.includes('completion_status') || element.includes('success_status')) {
          this.fetchScormStates().then(() => {
            if (this.courseStructure) {
              this.renderCourseStructure();
            }
            rendererLogger.info('CourseOutline: Immediate SCORM state refresh completed');
          }).catch(error => {
            rendererLogger.warn('CourseOutline: Immediate refresh failed', error);
            // Fallback to debounced refresh
            this.refreshScormStates();
          });
        } else {
          // For other changes, use debounced refresh
          this.refreshScormStates();
        }
      }
    });

    // Listen for navigation completion to refresh states
    this.subscribe('navigation:completed', () => {
      rendererLogger.debug('CourseOutline: Navigation completed, refreshing SCORM states');
      this.refreshScormStates();
    });

    // Listen for activity progress updates to refresh states
    this.subscribe('activity:progress:updated', (data) => {
      rendererLogger.debug('CourseOutline: Activity progress updated, refreshing SCORM states', data);
      this.refreshScormStates();
    });

    // Listen for objectives updates to refresh states
    this.subscribe('objectives:updated', (data) => {
      this.refreshScormStates();
    });

    // Listen for course outline refresh requests (triggered when completion changes may affect prerequisites)
    this.subscribe('course-outline:refresh-required', (data) => {
      rendererLogger.info('CourseOutline: Full refresh requested for prerequisite re-evaluation', data);
      this.fetchScormStates().then(() => {
        if (this.courseStructure) {
          this.renderCourseStructure();
        }
        rendererLogger.info('CourseOutline: Full prerequisite refresh completed');
      }).catch(error => {
        rendererLogger.warn('CourseOutline: Full refresh failed', error);
      });
    });
  }

  bindEvents() {
    super.bindEvents();

    if (this.expandAllBtn) {
      this.expandAllBtn.addEventListener('click', this.expandAll);
    }

    if (this.collapseAllBtn) {
      this.collapseAllBtn.addEventListener('click', this.collapseAll);
    }
  }

  renderCourseStructure() {
    if (!this.contentArea) {
      rendererLogger.warn('CourseOutline: Content area not available for rendering');
      return;
    }

    // Prefer normalized 'items', but guard for legacy 'children'
    const items = Array.isArray(this.courseStructure?.items) && this.courseStructure.items.length > 0
      ? this.courseStructure.items
      : (Array.isArray(this.courseStructure?.children) ? this.courseStructure.children : []);

    if (!this.courseStructure || !items || items.length === 0) {
      rendererLogger.info('CourseOutline.renderCourseStructure: empty state condition met', {
        hasStructure: !!this.courseStructure,
        hasItems: !!this.courseStructure?.items,
        itemCount: Array.isArray(this.courseStructure?.items) ? this.courseStructure.items.length : 0
      });
      this.showEmptyState();
      return;
    }

    const html = `
      <div class="course-outline__tree">
        ${this.renderItems(items)}
      </div>
    `;

    this.contentArea.innerHTML = html;
    this.bindItemEvents();
  }

  renderItems(items, depth = 0) {
    if (!items || items.length === 0) return '';

    return `
      <ul class="outline-list outline-list--depth-${depth}">
        ${items.map(item => this.renderItem(item, depth)).join('')}
      </ul>
    `;
  }

  renderItem(item, depth) {
    // Normalize child collection: prefer 'items' then legacy 'children'
    const childList = Array.isArray(item.items) ? item.items : (Array.isArray(item.children) ? item.children : []);
    const hasChildren = childList.length > 0;
    const isExpanded = this.expandedItems.has(item.identifier);
    const isCurrent = this.currentItem === item.identifier;
    const progress = this.progressData.get(item.identifier) || {};
    const scormState = this.scormStates.get(item.identifier);

    // Determine SCORM-based visual states for UI display (authoritative state only)
    // Only show as hidden if SCORM states are loaded AND the activity is actually hidden
    const isHidden = this.scormStatesLoaded && scormState && !scormState.isVisible && scormState.isVisible !== undefined;
    // Items are disabled until SCORM states are loaded; after that, disable only when sequencing disallows choice and not in browse mode
    const sequencingDisallowsChoice = !this.availableNavigation || !this.availableNavigation.includes('choice');
    const blockedByRules = !!(scormState && (scormState.preConditionResult?.action === 'disabled' || scormState.attemptLimitExceeded));
    const isDisabled = (!this.scormStatesLoaded) || (!this.browseModeEnabled && (sequencingDisallowsChoice || blockedByRules));
    const isSuspended = scormState && scormState.suspended;
    const attemptLimitReached = scormState && scormState.attemptLimitExceeded;

    // Compute coarse validation based on available navigation and browse mode
    const validation = {
      allowed: !!(this.browseModeEnabled || (Array.isArray(this.availableNavigation) && this.availableNavigation.includes('choice'))),
      reason: this.browseModeEnabled
        ? 'Browse mode'
        : (Array.isArray(this.availableNavigation) && this.availableNavigation.includes('choice')
            ? 'Allowed by availableNavigation'
            : 'Sequencing disallows choice')
    };



    // Debug logging for SCORM state changes
    if (scormState) {
      rendererLogger.debug('CourseOutline: Rendering item with SCORM state', {
        itemId: item.identifier,
        isVisible: scormState.isVisible,
        isDisabled: isDisabled,
        isSuspended: isSuspended,
        attemptLimitReached: attemptLimitReached,
        validationAllowed: validation.allowed,
        validationReason: validation.reason,
        browseModeEnabled: this.browseModeEnabled
      });
    }

    const itemClass = [
      'outline-item',
      hasChildren ? 'outline-item--parent' : 'outline-item--leaf',
      isCurrent ? 'outline-item--current' : '',
      isExpanded ? 'outline-item--expanded' : '',
      isHidden ? 'outline-item--hidden' : '',
      isDisabled ? 'outline-item--disabled' : '',
      isSuspended ? 'outline-item--suspended' : '',
      attemptLimitReached ? 'outline-item--attempt-limit-reached' : '',
      this.browseModeEnabled ? 'outline-item--browse-mode' : ''
    ].filter(Boolean).join(' ');

    // Build tooltip with comprehensive restriction information
    const tooltip = this.buildRestrictionTooltip(item.identifier, validation, scormState);

    return `
      <li class="${itemClass}" data-item-id="${item.identifier}" ${tooltip ? `title="${tooltip}"` : ''}>
        <div class="outline-item__content">
          ${hasChildren ? `
            <button class="outline-item__toggle" data-item-id="${item.identifier}">
              ${isExpanded ? '▼' : '▶'}
            </button>
          ` : '<span class="outline-item__spacer"></span>'}

          ${this.options.showIcons ? `
            <span class="outline-item__icon">${this.getItemIcon(item, progress, scormState)}</span>
          ` : ''}

          <span class="outline-item__title" data-item-id="${item.identifier}" ${isDisabled ? 'style="cursor: not-allowed;"' : ''}>
            ${escapeHTML(item.title || item.identifier)}
          </span>

          ${this.renderScormIndicators(scormState)}
          ${this.options.showProgress ? `
            <span class="outline-item__progress">${this.getProgressIndicator(progress)}</span>
          ` : ''}
        </div>

        ${hasChildren && isExpanded ? this.renderItems(childList, depth + 1) : ''}
      </li>
    `;
  }

  getItemIcon(item, progress, scormState) {
    // Show different icons based on SCORM state
    if (scormState) {
      if (!scormState.isVisible) {
        return '👁️‍🗨️'; // Hidden/eye blocked
      }
      if (scormState.suspended) {
        return '⏸️'; // Suspended
      }
      if (scormState.attemptLimitExceeded) {
        return '🚫'; // Blocked
      }
      if (scormState.preConditionResult && scormState.preConditionResult.action) {
        return '⚠️'; // Warning for restrictions
      }
    }

    if (item.type === 'sco') {
      return '📄'; // Simple document icon for all SCOs
    }
    return item.type === 'asset' ? '📎' : '📁';
  }

  /**
   * Build tooltip with SCORM sequencing information
   */
  buildRestrictionTooltip(activityId, validation, scormState) {
    if (!scormState) {
      return validation.allowed ? null : `Navigation: ${validation.reason}`;
    }

    const info = [];

    // Activity state information
    if (scormState.attemptCount > 0) {
      const limit = scormState.attemptLimit ? `/${scormState.attemptLimit}` : '';
      info.push(`Attempts: ${scormState.attemptCount}${limit}`);
    }

    if (scormState.activityState) {
      info.push(`State: ${scormState.activityState}`);
    }

    // Restrictions
    const restrictions = [];

    if (!scormState.isVisible) {
      restrictions.push('Hidden from choice');
    }

    if (scormState.attemptLimitExceeded) {
      restrictions.push('Attempt limit reached');
    }

    if (scormState.suspended) {
      restrictions.push('Activity suspended');
    }

    if (scormState.preConditionResult?.action) {
      const action = scormState.preConditionResult.action;
      const reason = scormState.preConditionResult.reason || `Rule: ${action}`;
      restrictions.push(reason);
    }

    if (restrictions.length > 0) {
      info.push('Restrictions: ' + restrictions.join(', '));
    }

    if (this.browseModeEnabled && restrictions.length > 0) {
      info.push('Browse mode: Restrictions bypassed');
    }

    return info.length > 0 ? info.join('\n') : null;
  }


  /**
   * Render SCORM state indicators (badges)
   */
  renderScormIndicators(scormState) {
    if (!scormState) return '';

    const indicators = [];

    // Activity state indicator
    if (scormState.activityState && scormState.activityState !== 'inactive') {
      const stateIcon = {
        'active': '🟢',
        'suspended': '⏸️',
        'completed': '✅'
      }[scormState.activityState] || '🔵';
      indicators.push(`<span class="scorm-badge scorm-badge--state" title="Activity State: ${scormState.activityState}">${stateIcon}</span>`);
    }

    // Attempt tracking with comprehensive info
    if (scormState.attemptCount > 0) {
      const limit = scormState.attemptLimit;
      const limitText = limit ? `/${limit}` : '';
      const isLimitReached = scormState.attemptLimitExceeded;
      const badgeClass = isLimitReached ? 'scorm-badge--limit-reached' : 'scorm-badge--attempts';
      const title = `Attempts: ${scormState.attemptCount}${limit ? ` of ${limit} allowed` : ''}`;
      indicators.push(`<span class="scorm-badge ${badgeClass}" title="${title}">${scormState.attemptCount}${limitText}</span>`);
    }

    // Sequencing rule restrictions with comprehensive actions
    if (scormState.preConditionResult?.action) {
      const action = scormState.preConditionResult.action;
      const reason = scormState.preConditionResult.reason || action;
      const actionIcon = {
        'disabled': '🚫',
        'hiddenFromChoice': '👁️‍🗨️',
        'skip': '⏭️',
        'exitParent': '↗️',
        'exitAll': '🚪',
        'continue': '▶️'
      }[action] || '⚠️';
      indicators.push(`<span class="scorm-badge scorm-badge--rule scorm-badge--rule-${action}" title="Sequencing Rule: ${reason}">${actionIcon}</span>`);
    }

    // Control mode restrictions
    if (scormState.controlMode && (!scormState.controlMode.choice || !scormState.controlMode.flow)) {
      const restrictions = [];
      if (!scormState.controlMode.choice) restrictions.push('Choice');
      if (!scormState.controlMode.flow) restrictions.push('Flow');
      const title = `Navigation restricted: ${restrictions.join(', ')} disabled`;
      indicators.push(`<span class="scorm-badge scorm-badge--control" title="${title}">🔒</span>`);
    }

    return indicators.length > 0 ? `<div class="outline-item__indicators">${indicators.join('')}</div>` : '';
  }

  getProgressIndicator(progress) {
    if (!progress.completionStatus && !progress.successStatus) return '';

    // Check for passed/failed status first
    if (progress.successStatus === 'passed') {
      return '<span class="progress-indicator progress-indicator--passed">✓</span>';
    }
    if (progress.successStatus === 'failed') {
      return '<span class="progress-indicator progress-indicator--failed">✗</span>';
    }

    // Fall back to completion status
    const statusMap = {
      'completed': '<span class="progress-indicator progress-indicator--completed">✓</span>',
      'incomplete': '<span class="progress-indicator progress-indicator--incomplete">○</span>',
      'not attempted': '<span class="progress-indicator progress-indicator--not-attempted">○</span>'
    };

    return statusMap[progress.completionStatus] || '<span class="progress-indicator progress-indicator--not-attempted">○</span>';
  }

  bindItemEvents() {
    this.findAll('.outline-item__toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.itemId : (e.target && e.target.dataset ? e.target.dataset.itemId : null);
        rendererLogger.debug('CourseOutline: Toggle clicked', {
          currentTargetId: e.currentTarget?.dataset?.itemId,
          targetId: e.target?.dataset?.itemId,
          resolvedId: id,
          eventType: 'toggle'
        });
        if (id) this.toggleItem(id);
      });
    });

    if (this.options.enableNavigation) {
      this.findAll('.outline-item__title').forEach(title => {
        title.addEventListener('click', (e) => {
          const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.itemId : (e.target && e.target.dataset ? e.target.dataset.itemId : null);
          rendererLogger.info('CourseOutline: Title clicked', {
            currentTargetId: e.currentTarget?.dataset?.itemId,
            targetId: e.target?.dataset?.itemId,
            resolvedId: id,
            eventType: 'navigation',
            scormStatesLoaded: this.scormStatesLoaded,
            hasScormState: id ? this.scormStates.has(id) : false,
            browseModeEnabled: this.browseModeEnabled
          });
          if (id) this.navigateToItem(id);
        });
      });
    }
  }

  toggleItem(itemId) {
    const wasExpanded = this.expandedItems.has(itemId);
    if (wasExpanded) {
      this.expandedItems.delete(itemId);
    } else {
      this.expandedItems.add(itemId);
    }

    rendererLogger.debug('CourseOutline: toggleItem called', {
      itemId,
      wasExpanded,
      nowExpanded: this.expandedItems.has(itemId),
      scormStatesLoaded: this.scormStatesLoaded,
      scormStatesCount: this.scormStates.size
    });

    this.renderCourseStructure();
    this.emit('itemToggled', { itemId, expanded: this.expandedItems.has(itemId) });
  }

  async navigateToItem(itemId) {
    if (!this.options.enableNavigation) {
      rendererLogger.warn('CourseOutline: Navigation disabled by options', { itemId });
      return;
    }
    // Authoritative gating: do not navigate until SCORM states are loaded
    if (!this.scormStatesLoaded) {
      rendererLogger.warn('CourseOutline: Navigation blocked until authoritative state is loaded', { itemId });
      return;
    }


    // Always delegate validation to SN service - no local validation
    rendererLogger.info('CourseOutline: Requesting navigation to item', {
      itemId,
      scormStatesLoaded: this.scormStatesLoaded,
      hasScormState: this.scormStates.has(itemId),
      browseModeEnabled: this.browseModeEnabled,
      availableNavigation: this.availableNavigation
    });



    this.setCurrentItem(itemId);

    // Validate via authoritative SN service before emitting navigation intent
    let allowed = true;
    let reason = 'Validation not performed';
    try {
      const snb = this.snBridge;
      if (snb && typeof snb.validateCourseOutlineChoice === 'function') {
        const res = await snb.validateCourseOutlineChoice(itemId);
        allowed = !!(res && res.success && res.allowed);
        reason = res?.reason || reason;
        rendererLogger.info('CourseOutline: Choice validation result', { itemId, allowed, reason });
      } else {
        rendererLogger.warn('CourseOutline: validateCourseOutlineChoice not available via snBridge; proceeding without validation');
      }
    } catch (validationError) {
      allowed = false;
      reason = validationError?.message || 'Validation error';
      rendererLogger.error('CourseOutline: Choice validation threw', { itemId, error: reason });
    }

    if (!allowed) {
      // Do not emit navigation intent when validation fails
      try {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
          throw new Error('eventBus unavailable');
        }
        this.eventBus.emit('navigationDenied', { itemId, reason });
      } catch (err) {
        rendererLogger.error('CourseOutline: Failed to emit navigationDenied', { itemId, error: err?.message || err });
      }
      return;
    }

    // Emit centralized choice intent for AppManager orchestration
    try {
      if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
        throw new Error('eventBus unavailable');
      }
      rendererLogger.info('CourseOutline: Emitting navigation:request event', {
        requestType: 'choice',
        activityId: itemId,
        source: 'course-outline'
      });
      this.eventBus.emit('navigation:request', { requestType: 'choice', activityId: itemId, source: 'course-outline' });
    } catch (error) {
      rendererLogger.error('CourseOutline: Failed to emit navigation:request', {
        itemId,
        error: error?.message || error
      });
    }


  }

  setCurrentItem(itemId) {
    // Prevent unnecessary updates if item is already current
    if (this.currentItem === itemId) {
      return;
    }

    this.currentItem = itemId;

    // Update UI to show current item
    this.findAll('.outline-item').forEach(el => {
      el.classList.toggle('outline-item--current', el.dataset.itemId === itemId);
    });

    // Emit event with flag to prevent recursive updates
    this.emit('currentItemChanged', {
      itemId,
      _fromCourseOutline: true
    });
  }


  expandAll() {
    this.expandedItems.clear();
    this.addAllItemIds(this.courseStructure?.items || []);
    this.renderCourseStructure();
    this.emit('allExpanded');
  }

  collapseAll() {
    this.expandedItems.clear();
    this.renderCourseStructure();
    this.emit('allCollapsed');
  }

  addAllItemIds(items) {
    items.forEach(item => {
      const childList = Array.isArray(item.items) ? item.items : (Array.isArray(item.children) ? item.children : []);
      if (childList.length > 0) {
        this.expandedItems.add(item.identifier);
        this.addAllItemIds(childList);
      }
    });
  }

  updateItemProgress(itemId, progress) {
    this.progressData.set(itemId, progress);
    this.renderCourseStructure();
  }

  showEmptyState() {
    if (!this.contentArea) {
      rendererLogger.warn('CourseOutline: Content area not available for empty state');
      return;
    }

    this.contentArea.innerHTML = `
      <div class="course-outline__empty">
        <div class="empty-state">
          <div class="empty-state__icon">📚</div>
          <div class="empty-state__title">No Course Loaded</div>
          <div class="empty-state__message">Load a SCORM course to view its structure</div>
        </div>
      </div>
    `;

    rendererLogger.info('CourseOutline: Empty state displayed');
  }


  // Removed eager loadCourseStructure path to avoid double-render with course:loaded subscription.
  // Initialization now emits a synthetic course:loaded when needed after subscriptions are ready.

  setCourseStructure(structure) {
    this.courseStructure = structure;
    this.expandedItems.clear();
    this.progressData.clear();
    this.currentItem = null;

    // Diagnostics: capture top-level identifiers to detect duplication at receiver side
    try {
      const topIds = Array.isArray(structure?.items)
        ? structure.items.slice(0, 48).map(n => n?.identifier || 'unknown')
        : [];
      rendererLogger.info('CourseOutline.setCourseStructure: top-level IDs', {
        count: topIds.length,
        ids: topIds
      });
    } catch (_) {}

    rendererLogger.info('CourseOutline.setCourseStructure: structure set', {
      hasItems: !!structure?.items,
      itemCount: structure?.items?.length || 0
    });
    this.renderCourseStructure();
  }

  async handleCourseLoaded(data) {
    const courseData = data.data || data;
    rendererLogger.info('CourseOutline.handleCourseLoaded: received', {
      hasStructure: !!courseData?.structure,
      hasItems: !!courseData?.structure?.items,
      itemCount: courseData?.structure?.items?.length || 0,
      currentScormStatesCount: this.scormStates.size,
      scormStatesLoaded: this.scormStatesLoaded,
      browseModeEnabled: this.browseModeEnabled,
      hasManifest: !!courseData?.manifest,
      courseTitle: courseData?.title || courseData?.courseTitle || 'unknown'
    });

    // Single-source renderer: only accept provided structure; do not rebuild from manifest.
    if (courseData.structure && Array.isArray(courseData.structure.items)) {
      // Signature guard: avoid re-applying identical structure
      try {
        const topIds = courseData.structure.items.slice(0, 64).map(n => n?.identifier || 'unknown');
        const sig = JSON.stringify({
          root: courseData.structure.identifier || 'course',
          count: courseData.structure.items.length,
          ids: topIds
        });
        if (this._lastAppliedSig === sig) {
          rendererLogger.debug('CourseOutline.handleCourseLoaded: identical structure signature; ignoring duplicate apply');
          return;
        }
        this._lastAppliedSig = sig;
      } catch (_) {}

      this.setCourseStructure(courseData.structure);
      // Expand all by default on initial load to make nested items visible (test and UX expectation)
      try { this.expandAll(); } catch (_) {}

      // CRITICAL FIX: Reset SCORM states before fetching new ones
      this.scormStates.clear();
      this.scormStatesLoaded = false;
      this.availableNavigation = [];

      rendererLogger.info('CourseOutline: SCORM states reset, fetching new states for course load');

      // Fetch comprehensive SCORM states for validation BEFORE initial render
      try {
        rendererLogger.info('CourseOutline: Waiting for SCORM states before initial render');
        await this.fetchScormStates();
        rendererLogger.info('CourseOutline: SCORM states loaded, performing initial render with validation', {
          stateCount: this.scormStates.size,
          scormStatesLoaded: this.scormStatesLoaded
        });

        // Re-render now that SCORM states are available
        if (this.courseStructure) {
          this.renderCourseStructure();
        }
      } catch (error) {
        rendererLogger.warn('CourseOutline: Failed to load SCORM states, rendering without validation', {
          message: error?.message || error,
          stack: error?.stack
        });
        // Ensure flag is reset on failure
        this.scormStatesLoaded = false;
      }

      return;
    }

    rendererLogger.warn('CourseOutline.handleCourseLoaded: structure missing or invalid; showing empty state');
    this.showEmptyState();
  }

  handleCourseCleared() {
    this.courseStructure = null;
    this.expandedItems.clear();
    this.progressData.clear();
    this.scormStates.clear();
    this.availableNavigation = [];
    this.currentItem = null;
    this.scormStatesLoaded = false; // Reset SCORM states loaded flag
    this.showEmptyState();
  }

  handleNavigationUpdated(data) {
    // Prevent recursive updates
    if (data._fromCourseOutline) {
      return;
    }

    const navData = data.data || data;

    // Only update if current item actually changed
    if (navData.currentItem && navData.currentItem !== this.currentItem) {
      this.setCurrentItem(navData.currentItem);
    }
  }

  handleProgressUpdated(data) {
    const progressData = data.data || data;

    if (this.currentItem && progressData) {
      this.updateItemProgress(this.currentItem, progressData);

      // If completion status changed to 'completed', refresh SCORM states
      // This ensures the course outline updates visual indicators when activities complete
      if (progressData.completionStatus === 'completed' || progressData.successStatus === 'passed') {
        rendererLogger.info('CourseOutline: Activity completed, refreshing SCORM states', {
          activityId: this.currentItem,
          completionStatus: progressData.completionStatus,
          successStatus: progressData.successStatus
        });
        this.refreshScormStates();
      }
    }
  }

  handleScormDataChanged(data) {
    const { element, value } = data.data || data;

    if (!this.currentItem) return;

    // Update progress based on SCORM data changes
    if (element === 'cmi.completion_status') {
      const currentProgress = this.progressData.get(this.currentItem) || {};
      this.updateItemProgress(this.currentItem, {
        ...currentProgress,
        completionStatus: value
      });
    } else if (element === 'cmi.success_status') {
      const currentProgress = this.progressData.get(this.currentItem) || {};
      this.updateItemProgress(this.currentItem, {
        ...currentProgress,
        successStatus: value
      });
    }
  }

  /**
   * Handle navigation launch event to update current item highlighting
   */
  handleNavigationLaunch(data) {
    try {
      if (data?.activity?.identifier) {
        rendererLogger.debug('CourseOutline: Updating current item from navigation launch', {
          activityId: data.activity.identifier,
          source: data.source
        });

        // Update the current item highlighting
        this.setCurrentItem(data.activity.identifier);

        // Also update UIState with current activity information
        if (this.uiState) {
          this.uiState.setState('currentActivity', {
            identifier: data.activity.identifier,
            title: data.activity.title,
            launchUrl: data.activity.launchUrl || data.activity.href
          });
        }
      } else {
        rendererLogger.warn('CourseOutline: Navigation launch event missing activity identifier', data);
      }
    } catch (error) {
      rendererLogger.error('CourseOutline: Error handling navigation launch', error);
    }
  }

  /**
   * BUG-022 FIX: Handle navigation state updates from AppManager
   */
  handleNavigationStateUpdate(stateData) {
    try {
      const { state, currentRequest } = stateData || {};

      // Update course outline visual state based on navigation state
      if (state === 'PROCESSING') {
        this.element.classList.add('course-outline--processing');
      } else {
        this.element.classList.remove('course-outline--processing');
      }

      rendererLogger.debug('CourseOutline: Updated for navigation state change', { state, requestType: currentRequest?.requestType });
    } catch (error) {
      rendererLogger.error('CourseOutline: Error handling navigation state update', error);
    }
  }

  /**
   * Handle browse mode changes
   */
  handleBrowseModeChanged(data) {
    try {
      const { enabled } = data || {};
      const previousBrowseMode = this.browseModeEnabled;
      this.browseModeEnabled = !!enabled;

      rendererLogger.info('CourseOutline: Browse mode changed', {
        enabled: this.browseModeEnabled,
        previousEnabled: previousBrowseMode,
        data: data,
        hasCourseStructure: !!this.courseStructure,
        scormStatesLoaded: this.scormStatesLoaded,
        scormStatesCount: this.scormStates.size
      });

      // Refresh the course structure display to reflect browse mode changes
      if (this.courseStructure) {
        rendererLogger.debug('CourseOutline: Re-rendering course structure for browse mode change');
        this.renderCourseStructure();
      } else {
        rendererLogger.warn('CourseOutline: No course structure available for browse mode re-render');
      }
    } catch (error) {
      rendererLogger.error('CourseOutline: Error handling browse mode change', {
        message: error?.message || error,
        stack: error?.stack,
        data: data
      });
    }
  }

  /**
   * Update course outline with course data (called by AppManager)
   * @param {Object} courseData - Course data from course loader
   */
  updateWithCourse(courseData) {
    try { rendererLogger.info('CourseOutline: updateWithCourse called with:', !!courseData ? '[object]' : 'null'); } catch (_) {}

    try {
      // Ensure base HTML exists before rendering items
      if (!this.element.querySelector('.course-outline__container')) {
        this.renderContent();
      }

      // Single-source renderer: only accept provided structure; do not rebuild or convert from manifest.
      const structure = (courseData && courseData.structure && Array.isArray(courseData.structure.items))
        ? courseData.structure
        : null;

      if (structure) {
        // Signature guard against double-apply
        try {
          const ids = structure.items.slice(0, 64).map(n => n?.identifier || 'unknown');
          const sig = JSON.stringify({
            root: structure.identifier || 'course',
            count: structure.items.length,
            ids
          });
          if (this._lastAppliedSig === sig) {
            rendererLogger.debug('CourseOutline.updateWithCourse: identical structure signature; ignoring duplicate apply');
            return;
          }
          this._lastAppliedSig = sig;
        } catch (_) {}

        this.setCourseStructure(structure);
        try { rendererLogger.info('CourseOutline: Course structure updated successfully'); } catch (_) {}
      } else {
        try { rendererLogger.warn('CourseOutline: No valid structure found in course data'); } catch (_) {}
        this.showEmptyState();
      }

    } catch (error) {
      try { rendererLogger.error('CourseOutline: Error updating with course data:', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Fetch comprehensive SCORM states for course outline
   */
  async fetchScormStates() {
    try {
      const snb = this.snBridge;

      if (!snb || typeof snb.getCourseOutlineActivityTree !== 'function') {
        rendererLogger.warn('CourseOutline: getCourseOutlineActivityTree not available via snBridge');
        this.scormStatesLoaded = false;
        return null;
      }

      rendererLogger.info('CourseOutline: Calling SNBridge.getCourseOutlineActivityTree');
      const result = await snb.getCourseOutlineActivityTree();
      rendererLogger.debug('CourseOutline: fetchScormStates IPC result received', {
        success: result?.success,
        hasData: !!result?.data,
        dataType: typeof result?.data,
        isFallback: result?.fallback,
        fallbackReason: result?.reason,
        error: result?.error
      });

      if (result.success && result.data) {
        this.processScormStates(result.data);
        rendererLogger.info('CourseOutline: SCORM states fetched and processed successfully', {
          stateCount: this.scormStates.size,
          isFallback: result?.fallback,
          fallbackReason: result?.reason,
          sampleStateKeys: Array.from(this.scormStates.keys()).slice(0, 5)
        });

        // Also fetch available navigation
        await this.fetchAvailableNavigation();

        return result.data;
      } else {
        rendererLogger.warn('CourseOutline: Failed to fetch SCORM states', {
          success: result?.success,
          hasData: !!result?.data,
          error: result?.error,
          fallback: result?.fallback,
          reason: result?.reason
        });
        this.scormStatesLoaded = false;
        return null;
      }
    } catch (error) {
      rendererLogger.error('CourseOutline: Error fetching SCORM states', {
        message: error?.message || error,
        stack: error?.stack,
        name: error?.name
      });
      this.scormStatesLoaded = false;
      return null;
    }
  }

  /**
   * Refresh SCORM states and available navigation - simplified and robust
   */
  async refreshScormStates() {
    // Debounce rapid refresh requests
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
    }

    this._refreshTimeout = setTimeout(async () => {
      try {
        rendererLogger.info('CourseOutline: Refreshing SCORM states');

        // Reset loaded flag while refreshing
        this.scormStatesLoaded = false;

        await this.fetchScormStates();

        if (this.courseStructure) {
          this.renderCourseStructure();
        }

        rendererLogger.info('CourseOutline: SCORM states refreshed successfully');
      } catch (error) {
        rendererLogger.warn('CourseOutline: Failed to refresh SCORM states', error);
        // Keep previous states if refresh fails
        this.scormStatesLoaded = this.scormStates.size > 0;
      } finally {
        this._refreshTimeout = null;
      }
    }, 100); // Reduced debounce to 100ms for faster UI updates
  }

  /**
   * Fetch available navigation from SN service
   */
  async fetchAvailableNavigation() {
    try {
      const snb = this.snBridge;
      if (!snb || typeof snb.getCourseOutlineAvailableNavigation !== 'function') {
        rendererLogger.warn('CourseOutline: getCourseOutlineAvailableNavigation not available via snBridge');
        return [];
      }

      const result = await snb.getCourseOutlineAvailableNavigation();
      if (result.success && Array.isArray(result.data)) {
        this.availableNavigation = result.data;
        rendererLogger.info('CourseOutline: Available navigation fetched successfully', this.availableNavigation.length);
        return result.data;
      } else {
        rendererLogger.warn('CourseOutline: Failed to fetch available navigation', result.error);
        this.availableNavigation = [];
        return [];
      }
    } catch (error) {
      rendererLogger.error('CourseOutline: Error fetching available navigation', error);
      this.availableNavigation = [];
      return [];
    }
  }

  /**
   * Process and store SCORM states from activity tree
   */
  processScormStates(activityTree) {
    this.scormStates.clear();
    this.processActivityNode(activityTree);
    this.scormStatesLoaded = true;
    rendererLogger.info('CourseOutline: SCORM states processed and loaded', {
      stateCount: this.scormStates.size,
      scormStatesLoaded: this.scormStatesLoaded
    });
  }

  /**
   * Recursively process activity tree nodes
   */
  processActivityNode(node) {
    if (node.id && node.scormState) {
      this.scormStates.set(node.id, node.scormState);
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => this.processActivityNode(child));
    }
  }



  /**
   * Show navigation blocked message to user
   */
  showNavigationBlockedMessage(activityId, reason) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.className = 'course-outline__notification course-outline__notification--error';
    const safeReason = escapeHTML(String(reason || ''));
    notification.innerHTML = `
      <div class="notification__content">
        <div class="notification__icon">⚠️</div>
        <div class="notification__message">
          <strong>Navigation Blocked</strong><br>
          ${safeReason}
        </div>
        <button class="notification__close">×</button>
      </div>
    `;

    // Add to DOM
    this.element.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);

    // Close button handler
    const closeBtn = notification.querySelector('.notification__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      });
    }
  }

  /**
    * Convert manifest data to course structure format
    * @param {Object} manifest - SCORM manifest data
    * @returns {Object} Course structure
    */
   // Removed manifest-to-structure conversion in renderer to keep single-source of truth from CAM.
   convertManifestToStructure(_) {
     return null;
   }

   /**
    * Convert manifest items to structure items
    * @param {Array|Object} items - Manifest items
    * @returns {Array} Structure items
    */
   convertManifestItems(_) {
     return [];
   }

   destroy() {
     // Clean up debounce timeout
     if (this._refreshTimeout) {
       clearTimeout(this._refreshTimeout);
       this._refreshTimeout = null;
     }

     this.expandedItems.clear();
     this.progressData.clear();
     this.scormStates.clear();
     this.availableNavigation = [];
     this.scormStatesLoaded = false; // Reset SCORM states loaded flag
     super.destroy();
   }
}

export { CourseOutline };
