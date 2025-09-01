/**
 * Navigation Controls Component
 * 
 * Provides LMS-style navigation bar that integrates with the main process
 * SCORM Sequencing and Navigation (SN) service. Eliminates duplicate navigation
 * logic by delegating to proper SCORM-compliant services.
 * 
 * @fileoverview SCORM navigation controls component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { snBridge } from '../../services/sn-bridge.js';

/**
 * Navigation Controls Class
 * 
 * Manages LMS-style navigation UI that delegates navigation logic
 * to the main process SCORM SN service for proper compliance.
 */
class NavigationControls extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);

    this.navigationState = {
      availableNavigation: ['previous', 'continue'], // Default fallback navigation
      currentActivity: null,
      sequencingState: null,
      menuVisible: false
    };

    this.snService = null; // Will be set via IPC bridge
  }

  /**
   * Get default options
   */
  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'navigation-controls',
      showTitle: true,
      showStatus: true,
      enableKeyboardNavigation: true,
      attributes: {
        'data-component': 'navigation-controls'
      }
    };
  }

  /**
   * Setup component
   */
  async setup() {
    this.uiState = await uiStatePromise;
    
    // Initialize logger via renderer-logger with safe fallback
    try {
      const { rendererLogger } = await import('../../utils/renderer-logger.js');
      this.logger = rendererLogger || null;
    } catch (_) {
      this.logger = null;
    }
    
    await this.initializeSNServiceBridge();
    this.loadNavigationState();

    // Initialize browse mode status
    await this.initializeBrowseModeStatus();

    // Subscribe to authoritative navigation state from UIState
    try {
      this._unsubscribeNav = this.uiState.subscribe((newNavState) => {
        // Normalize and apply with loop guard
        const normalized = this.normalizeNavStateFromUI(newNavState || {});
        this.updateNavigationState({ ...normalized, _fromUIState: true });
      }, 'navigationState');
    } catch (e) {
      this.logger?.warn('NavigationControls: Failed to subscribe to UIState navigationState', e?.message || e);
    }

    // Subscribe to browse mode state changes
    try {
      this._unsubscribeBrowseMode = this.uiState.subscribe((browseModeState) => {
        if (browseModeState && typeof browseModeState.enabled === 'boolean') {
          this.updateModeToggle(browseModeState.enabled);
          this.updateNavigationForBrowseMode(browseModeState.enabled);
        }
      }, 'browseMode');
    } catch (e) {
      this.logger?.warn('NavigationControls: Failed to subscribe to UIState browseMode', e?.message || e);
    }
  }

  /**
   * Initialize browse mode status
   */
  async initializeBrowseModeStatus() {
    try {
      // Check current browse mode status
      const status = await window.electronAPI.invoke('browse-mode-status');

      if (status && status.enabled) {
        // Update UI state
        if (this.uiState) {
          this.uiState.setState('browseMode', {
            enabled: true,
            session: status.session,
            config: status.config || {}
          });
        }

        // Update UI to reflect browse mode
        this.updateModeToggle(true);
        this.updateNavigationForBrowseMode(true);
        
        // Ensure navigation is available in browse mode
        if (!this.navigationState.availableNavigation.includes('previous')) {
          this.navigationState.availableNavigation.push('previous');
        }
        if (!this.navigationState.availableNavigation.includes('continue')) {
          this.navigationState.availableNavigation.push('continue');
        }
        this.updateButtonStates();

        this.logger?.info('NavigationControls: Browse mode already enabled', status);
      }
    } catch (error) {
      this.logger?.warn('NavigationControls: Failed to initialize browse mode status', error);
    }
  }

  /**
   * Initialize bridge to main process SN service
   */
  async initializeSNServiceBridge() {
    try {
      const initResult = await snBridge.initialize();
      if (initResult.success) {
        this.snService = snBridge;
        this.updateNavigationState({ 
          snServiceAvailable: true,
          snServiceError: null 
        });

        // Proactively pull current sequencing state to sync button availability
        try {
          const state = await this.snService.getSequencingState();
          if (state && Array.isArray(state.availableNavigation)) {
            this.updateAvailableNavigation(state.availableNavigation);
            try {
              const normalized = this.normalizeAvailableNavigation(state.availableNavigation);
              this.uiState?.updateNavigation({ ...normalized, _fromComponent: true });
            } catch (e) {
              this.logger?.warn('NavigationControls: Failed to sync initial availability to UIState', e?.message || e);
            }
          }
        } catch (e) {
          this.logger?.debug('NavigationControls: Initial sequencing state unavailable', e?.message || e);
        }
      } else {
        this.snService = null;
        this.updateNavigationState({ 
          snServiceAvailable: false,
          snServiceError: initResult.error || 'Failed to initialize SN service'
        });
        this.showFallbackMode('SN service unavailable - using simplified navigation');
      }
    } catch (error) {
      this.snService = null;
      this.updateNavigationState({ 
        snServiceAvailable: false,
        snServiceError: error.message 
      });
      this.showFallbackMode('Navigation service error - using basic controls');
    }
  }

  /**
   * Render component content
   */
  renderContent() {
    this.element.innerHTML = `
      <div class="navigation-controls__container">
        <div class="navigation-controls__left">
          <div class="navigation-controls__title" id="${this.elementId}-title">
            Learning Management System
          </div>
          <div class="navigation-controls__status" id="${this.elementId}-status">
            No course loaded
          </div>
        </div>
        
        <div class="navigation-controls__center">
          <div class="navigation-controls__progress" id="${this.elementId}-progress" style="display: none;">
            <div class="progress-bar">
              <div class="progress-fill" id="${this.elementId}-progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-text" id="${this.elementId}-progress-text">0%</div>
          </div>
        </div>
        
        <div class="navigation-controls__right">
          <!-- Mode Toggle -->
          <div class="mode-toggle" id="${this.elementId}-mode-toggle">
            <button class="mode-btn mode-btn--learner active" id="${this.elementId}-learner-mode">🎓 Learner Mode</button>
            <button class="mode-btn mode-btn--browse" id="${this.elementId}-browse-mode">🔍 Browse Mode</button>
          </div>
          
          <button 
            class="navigation-controls__btn navigation-controls__btn--previous" 
            id="${this.elementId}-previous"
            disabled
            title="Previous Activity (respects course sequencing)"
            aria-describedby="${this.elementId}-prev-status"
          >
            ← Previous Activity
          </button>
          
          <button 
            class="navigation-controls__btn navigation-controls__btn--next" 
            id="${this.elementId}-next"
            disabled
            title="Next Activity (respects course sequencing)"
            aria-describedby="${this.elementId}-next-status"
          >
            Next Activity →
          </button>
          
          <button 
            class="navigation-controls__btn navigation-controls__btn--menu" 
            id="${this.elementId}-menu"
            title="Toggle Course Menu"
          >
            📚 Course Menu
          </button>
        </div>
        
        <div class="navigation-controls__context" id="${this.elementId}-context" style="display: none;">
          <div class="nav-context">
            <span class="nav-context__position" id="${this.elementId}-position">Activity 1 of 1</span>
            <span class="nav-context__title" id="${this.elementId}-title-display">No activity selected</span>
            <span class="nav-context__type" id="${this.elementId}-type">SCO</span>
          </div>
          <div id="${this.elementId}-prev-status" class="sr-only">
            Navigation to previous activity respects course sequencing rules
          </div>
          <div id="${this.elementId}-next-status" class="sr-only">
            Navigation to next activity respects course sequencing rules
          </div>
        </div>
      </div>
    `;

    // Get references to elements
    this.titleElement = this.find('.navigation-controls__title');
    this.statusElement = this.find('.navigation-controls__status');
    this.progressElement = this.find('.navigation-controls__progress');
    this.progressFill = this.find('.progress-fill');
    this.progressText = this.find('.progress-text');
    this.previousBtn = this.find('.navigation-controls__btn--previous');
    this.nextBtn = this.find('.navigation-controls__btn--next');
    this.menuBtn = this.find('.navigation-controls__btn--menu');
    
    // Mode toggle elements
    this.modeToggle = this.find('.mode-toggle');
    this.learnerModeBtn = this.find('.mode-btn--learner');
    this.browseModeBtn = this.find('.mode-btn--browse');
    
    // Navigation context elements
    this.contextElement = this.find('.navigation-controls__context');
    this.positionElement = this.find('.nav-context__position');
    this.titleDisplayElement = this.find('.nav-context__title');
    this.typeElement = this.find('.nav-context__type');
  }

  /**
   * Setup event subscriptions
   */
  setupEventSubscriptions() {
    // Listen for course events
    this.subscribe('course:loaded', this.handleCourseLoaded);
    this.subscribe('course:cleared', this.handleCourseCleared);
    
    // Listen for navigation events
    this.subscribe('navigation:updated', this.handleNavigationUpdated);
    
    // Listen for progress events
    this.subscribe('progress:updated', this.handleProgressUpdated);
    
    // Listen for SCORM events
    this.subscribe('scorm:initialized', this.handleScormInitialized);
    this.subscribe('scorm:dataChanged', this.handleScormDataChanged);
    
    // Listen for UI events
    this.subscribe('ui:updated', this.handleUIUpdated);
    
    // BUG-022 FIX: Subscribe to navigation state updates
    this.subscribe('navigation:state:updated', this.handleNavigationStateUpdate);
  }

  /**
   * Bind component events
   */
  bindEvents() {
    super.bindEvents();

    // Ensure 'this' context is bound for handlers used with addEventListener
    if (!this._boundHandlers) {
      this._boundHandlers = {
        handlePreviousClick: this.handlePreviousClick.bind(this),
        handleNextClick: this.handleNextClick.bind(this),
        handleLearnerModeClick: this.handleLearnerModeClick.bind(this),
        handleBrowseModeClick: this.handleBrowseModeClick.bind(this),
        handleKeyDown: this.handleKeyDown.bind(this)
      };
    }

    // Guard existence of elements before binding
    if (this.previousBtn && this._boundHandlers.handlePreviousClick) {
      this.previousBtn.addEventListener('click', this._boundHandlers.handlePreviousClick);
    }
    
    if (this.nextBtn && this._boundHandlers.handleNextClick) {
      this.nextBtn.addEventListener('click', this._boundHandlers.handleNextClick);
    }
    
    // Simple direct menu button handler - no complex binding
    if (this.menuBtn) {
      this.menuBtn.addEventListener('click', () => {
        this.toggleMenu();
      });
    }
    
    // Mode toggle button event listeners
    if (this.learnerModeBtn && this._boundHandlers.handleLearnerModeClick) {
      this.learnerModeBtn.addEventListener('click', this._boundHandlers.handleLearnerModeClick);
    }

    if (this.browseModeBtn && this._boundHandlers.handleBrowseModeClick) {
      this.browseModeBtn.addEventListener('click', this._boundHandlers.handleBrowseModeClick);
    }
    
    // Keyboard navigation with guard against missing binding
    if (this.options.enableKeyboardNavigation && this._boundHandlers.handleKeyDown) {
      document.addEventListener('keydown', this._boundHandlers.handleKeyDown);
    }
  }

  /**
   * Handle previous button click
   */
  async handlePreviousClick() {
    // In browse mode, always allow navigation, otherwise check availability
    const browseMode = this.uiState?.getState('browseMode')?.enabled || false;

    this.logger?.info('NavigationControls: Previous button clicked', { browseMode });

    if (!browseMode && !this.isNavigationAvailable('previous')) {
      this.logger?.debug('NavigationControls: Previous navigation not available in normal mode');
      return;
    }

    // BUG-002 FIX: Emit unified navigationRequest with standardized payload
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('navigationRequest', {
        activityId: null, // Previous navigation doesn't target specific activity
        activityObject: null,
        requestType: 'previous',
        source: 'NavigationControls'
      });
      this.logger?.info('NavigationControls: Emitted navigationRequest event for previous');
    } catch (_) {
      // fall through; component-local behavior remains
    }

    this.emit('navigationRequested', { direction: 'previous' });
  }

  /**
   * Handle next button click
   */
  async handleNextClick() {
    // In browse mode, always allow navigation, otherwise check availability
    const browseMode = this.uiState?.getState('browseMode')?.enabled || false;

    this.logger?.info('NavigationControls: Next button clicked', { browseMode });

    if (!browseMode && !this.isNavigationAvailable('continue')) {
      this.logger?.debug('NavigationControls: Continue navigation not available in normal mode');
      return;
    }

    // BUG-002 FIX: Emit unified navigationRequest with standardized payload
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('navigationRequest', {
        activityId: null, // Continue navigation doesn't target specific activity
        activityObject: null,
        requestType: 'continue',
        source: 'NavigationControls'
      });
      this.logger?.info('NavigationControls: Emitted navigationRequest event for continue');
    } catch (_) {
      // fall through; component-local behavior remains
    }

    this.emit('navigationRequested', { direction: 'next' });
  }

  /**
   * Simple menu toggle - just works
   */
  toggleMenu() {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) {
      // Error logging for missing sidebar - indicates serious DOM issue
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger?.error('NavigationControls: Sidebar element not found during menu toggle');
      }).catch(() => {});
      return;
    }

    try {
      // Simple toggle logic
      const isHidden = sidebar.classList.contains('app-sidebar--hidden');

      if (isHidden) {
        // Show sidebar
        sidebar.classList.remove('app-sidebar--hidden');
        if (this.menuBtn) {
          this.menuBtn.textContent = '✕ Hide Menu';
        }
      } else {
        // Hide sidebar
        sidebar.classList.add('app-sidebar--hidden');
        if (this.menuBtn) {
          this.menuBtn.textContent = '📚 Course Menu';
        }
      }
    } catch (error) {
      // Error logging for unexpected failures
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger?.error('NavigationControls: Menu toggle failed', error?.message || error);
      }).catch(() => {});
    }
  }

  /**
   * Handle learner mode button click (BUG-005 FIX)
   */
  async handleLearnerModeClick() {
    // Use centralized browse mode management
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('browseMode:toggle', { enabled: false });
    } catch (error) {
      this.logger?.error('NavigationControls: Failed to disable browse mode', error);
    }
  }

  /**
   * Handle browse mode button click (BUG-005 FIX)
   */
  async handleBrowseModeClick() {
    // Use centralized browse mode management
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('browseMode:toggle', { enabled: true });
    } catch (error) {
      this.logger?.error('NavigationControls: Failed to enable browse mode', error);
    }
  }

  /**
   * Handle keyboard navigation
   */
  handleKeyDown(event) {
    // Only handle if no input is focused
    if (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable) {
      return;
    }
    
    switch (event.key) {
      case 'ArrowLeft':
        if (this.navigationState.canNavigatePrevious) {
          event.preventDefault();
          this.handlePreviousClick();
        }
        break;
        
      case 'ArrowRight':
        if (this.navigationState.canNavigateNext) {
          event.preventDefault();
          this.handleNextClick();
        }
        break;
        
      case 'Escape':
        if (this.navigationState.menuVisible) {
          event.preventDefault();
          this.setMenuVisible(false);
        }
        break;
    }
  }

  /**
   * Process navigation request via main process SN service
   */
  async processNavigation(navigationRequest, targetActivityId = null) {
    try {
      this.logger?.info(`NavigationControls: Processing navigation request: ${navigationRequest}`, {
        snServiceAvailable: !!this.snService,
        targetActivityId
      });
      
      if (!this.snService) {
        this.logger?.warn('NavigationControls: SN service not available, falling back to content navigation');
        return this.fallbackContentNavigation(navigationRequest);
      }
      
      // Use main process SN service for proper SCORM navigation
      const result = await this.snService.processNavigation(navigationRequest, targetActivityId);
      
      this.logger?.info('NavigationControls: SN service result:', result);
      
      if (result.success) {
        // Update UI state based on navigation result
        await this.handleNavigationResult(result);
        this.emit('navigationProcessed', { request: navigationRequest, result });
      } else {
        this.logger?.warn('NavigationControls: Navigation request failed:', result.reason);
        this.emit('navigationError', { 
          direction: navigationRequest, 
          error: result.reason,
          fallback: true 
        });
        // Try fallback navigation for better UX
        this.logger?.info('NavigationControls: Trying fallback navigation');
        return this.fallbackContentNavigation(navigationRequest);
      }
      
      return result;
    } catch (error) {
      this.logger?.error('NavigationControls: Navigation processing error:', error);
      this.emit('navigationError', { direction: navigationRequest, error });
      return this.fallbackContentNavigation(navigationRequest);
    }
  }

  /**
   * Handle navigation result and update content
   */
  async handleNavigationResult(result) {
    this.logger?.info('NavigationControls: Handling navigation result', result);

    if (result.targetActivity && result.action === 'launch') {
      this.logger?.info('NavigationControls: Launching activity', result.targetActivity);

      // BUG-002 FIX: Use unified navigationRequest event instead of activityLaunchRequested
      try {
        const { eventBus } = await import('../../services/event-bus.js');
        
        // Emit unified navigationRequest with standardized payload
        eventBus.emit('navigationRequest', {
          activityId: result.targetActivity?.identifier || result.targetActivity?.id,
          activityObject: result.targetActivity,
          requestType: 'activityLaunch',
          source: 'NavigationControls',
          sequencing: result.sequencing
        });

        // Also emit navigation:launch for components that need launch-specific handling
        eventBus.emit('navigation:launch', {
          activity: result.targetActivity,
          sequencing: result.sequencing,
          source: 'navigation-controls',
          // Include current activity information for UI synchronization
          currentActivity: result.targetActivity,
          navigationResult: result
        });
        
        this.logger?.info('NavigationControls: Emitted unified navigation events', {
          activityId: result.targetActivity?.identifier,
          requestType: 'activityLaunch'
        });
      } catch (error) {
        this.logger?.error('NavigationControls: Failed to emit navigation events', error);
        
        // Fallback to component-level event if global event bus fails
        this.emit('activityLaunchRequested', {
          activity: result.targetActivity,
          sequencing: result.sequencing
        });
      }
    } else {
      this.logger?.warn('NavigationControls: No target activity to launch', { result });
    }

    // Update available navigation options
    if (result.availableNavigation) {
      // Normalize into canNavigatePrevious/Next and push through UIState as authority
      const normalized = this.normalizeAvailableNavigation(result.availableNavigation);
      try {
        this.uiState.updateNavigation({
          ...normalized,
          _fromComponent: true // prevent ping-pong loops
        });
      } catch (e) {
        this.logger?.warn('NavigationControls: Failed to update UIState with navigation availability', e?.message || e);
      }
      // Also reflect locally for immediate button state sync
      this.updateAvailableNavigation(result.availableNavigation);

      // Emit centralized availability update to keep interested parties in sync
      // BUT prevent self-triggering by adding a flag
      try {
        const { eventBus } = await import('../../services/event-bus.js');
        eventBus.emit('navigation:updated', {
          ...normalized,
          source: 'navigation-controls',
          _fromNavigationResult: true // prevent self-triggering
        });
      } catch (_) { /* no-op */ }
    }
  }

  /**
   * Update available navigation options from SN service
   */
  updateAvailableNavigation(availableNavigation) {
    this.navigationState.availableNavigation = availableNavigation || [];
    // derive authoritative booleans
    const normalized = this.normalizeAvailableNavigation(this.navigationState.availableNavigation);
    this.navigationState.canNavigatePrevious = normalized.canNavigatePrevious;
    this.navigationState.canNavigateNext = normalized.canNavigateNext;

    this.updateButtonStates();
    
    this.logger?.debug('NavigationControls: Available navigation updated:', availableNavigation);
  }

  /**
   * Check if specific navigation is available
   */
  isNavigationAvailable(navigationType) {
    return this.navigationState.availableNavigation.includes(navigationType);
  }

  /**
   * Fallback content navigation for when SN service is unavailable
   * This is a simplified version that tries basic content navigation
   */
  async fallbackContentNavigation(navigationRequest) {
    // Check if a course is actually loaded before attempting any navigation
    const courseInfo = this.uiState?.getState('courseInfo');
    const courseStructure = this.uiState?.getState('courseStructure');
    const hasCourseLoaded = !!(courseInfo && courseStructure);

    if (!hasCourseLoaded) {
      // Only load sample course if there's genuinely no course loaded
      const browseMode = this.uiState?.getState('browseMode')?.enabled || false;
      if (browseMode && window.loadSampleCourse && typeof window.loadSampleCourse === 'function') {
        this.logger?.info('NavigationControls: No course loaded in browse mode, attempting to load sample course');

        try {
          await window.loadSampleCourse();
          this.logger?.info('NavigationControls: Sample course loaded successfully');

          // After loading, try navigation again with a delay
          setTimeout(async () => {
            try {
              const result = await this.snService?.processNavigation(navigationRequest);
              if (result?.success) {
                await this.handleNavigationResult(result);
                this.logger?.info('NavigationControls: Navigation succeeded after course load');
              } else {
                this.logger?.warn('NavigationControls: Navigation still failed after course load');
              }
            } catch (retryError) {
              this.logger?.error('NavigationControls: Retry navigation failed:', retryError);
            }
          }, 1000);

          return {
            success: true,
            reason: `Browse mode ${navigationRequest} - loaded sample course, retrying navigation`,
            fallback: true,
            browseMode: true,
            courseLoaded: true
          };
        } catch (loadError) {
          this.logger?.error('NavigationControls: Failed to load sample course:', loadError);
        }
      }

      // No course loaded and couldn't load sample course
      this.logger?.warn('NavigationControls: No course loaded, cannot perform navigation');
      return {
        success: false,
        reason: 'No course loaded - cannot perform navigation',
        fallback: true
      };
    }

    // Course is loaded, but SN service should handle all navigation including browse mode
    // Remove inconsistent fallback logic that uses different data sources
    this.logger?.warn(`NavigationControls: SN service unavailable but course loaded - cannot perform ${navigationRequest} navigation`);
    return {
      success: false,
      reason: 'SN service unavailable - navigation requires proper SCORM sequencing service',
      fallback: true
    };
  }

  /**
   * Try content-based navigation (simplified fallback version)
   */
  tryContentNavigation(contentWindow, direction) {
    // Try Storyline navigation first (most common)
    if (this.tryStorylineNavigation(contentWindow, direction)) {
      return true;
    }
    
    // Try Captivate navigation
    if (this.tryCaptivateNavigation(contentWindow, direction)) {
      return true;
    }
    
    // Try generic button navigation as last resort
    return this.tryGenericButtonNavigation(contentWindow.document, direction);
  }

  /**
   * Try Storyline navigation
   */
  tryStorylineNavigation(contentWindow, direction) {
    try {
      const player = contentWindow.GetPlayer?.() || contentWindow.parent?.GetPlayer?.();
      if (player) {
        if (direction === 'next' && player.NextSlide) {
          player.NextSlide();
          return true;
        } else if (direction === 'previous' && player.PrevSlide) {
          player.PrevSlide();
          return true;
        }
      }
    } catch (error) {
      // Silently continue to other methods
    }
    return false;
  }

  /**
   * Try Captivate navigation
   */
  tryCaptivateNavigation(contentWindow, direction) {
    try {
      if (contentWindow.cpAPIInterface) {
        if (direction === 'next') {
          contentWindow.cpAPIInterface.next();
          return true;
        } else if (direction === 'previous') {
          contentWindow.cpAPIInterface.previous();
          return true;
        }
      }
    } catch (error) {
      // Silently continue to other methods
    }
    return false;
  }

  /**
   * Try generic button navigation (enhanced with common patterns)
   */
  tryGenericButtonNavigation(contentDocument, direction) {
    const selectors = direction === 'next' ?
      [
        '.next-btn', '.btn-next', '.continue',
        // Add common navigation patterns found in real courses
        '[data-nav="next"]', '.navigation-next',
        '[aria-label*="next" i]', '[aria-label*="continue" i]',
        'button:has-text("Next")', 'button:has-text("Continue")',
        '.nav-next', '.btn-continue'
      ] :
      [
        '.prev-btn', '.btn-prev', '.previous', '.back',
        // Add common navigation patterns found in real courses
        '[data-nav="prev"]', '.navigation-prev',
        '[aria-label*="previous" i]', '[aria-label*="back" i]',
        'button:has-text("Previous")', 'button:has-text("Back")',
        '.nav-prev', '.btn-back'
      ];

    for (const selector of selectors) {
      try {
        const button = contentDocument.querySelector(selector);
        if (button && !button.disabled && button.offsetParent !== null) {
          button.click();
          return true;
        }
      } catch (error) {
        // Continue to next selector
      }
    }
    return false;
  }

  /**
   * Find adjacent activity in current course structure for browse mode navigation
   * @param {string} direction - 'continue' or 'previous'
   * @param {Object} courseStructure - Current course structure
   * @returns {Object|null} Adjacent activity or null if not found
   */
  findAdjacentActivity(direction, courseStructure) {
    if (!courseStructure || !courseStructure.items) {
      return null;
    }

    // Get current activity from UIState
    const currentActivityId = this.uiState?.getState('currentActivity')?.identifier;
    if (!currentActivityId) {
      // No current activity, return first or last activity based on direction
      const activities = this.flattenActivities(courseStructure.items);
      if (activities.length === 0) return null;

      return direction === 'continue' ? activities[0] : activities[activities.length - 1];
    }

    // Find current activity and get adjacent one
    const activities = this.flattenActivities(courseStructure.items);
    const currentIndex = activities.findIndex(activity => activity.identifier === currentActivityId);

    if (currentIndex === -1) {
      // Current activity not found, return first activity
      return activities.length > 0 ? activities[0] : null;
    }

    if (direction === 'continue' && currentIndex < activities.length - 1) {
      return activities[currentIndex + 1];
    } else if (direction === 'previous' && currentIndex > 0) {
      return activities[currentIndex - 1];
    }

    // No adjacent activity in that direction
    return null;
  }

  /**
   * Flatten course structure into array of activities
   * @param {Array} items - Course structure items
   * @returns {Array} Flattened array of activities
   */
  flattenActivities(items) {
    const activities = [];

    function traverse(item) {
      if (item.type === 'sco' || item.identifierref) {
        // This is a launchable activity
        activities.push({
          identifier: item.identifier,
          title: item.title || item.identifier,
          launchUrl: item.href,
          type: item.type
        });
      }

      // Recursively traverse children
      const children = item.items || item.children || [];
      children.forEach(traverse);
    }

    items.forEach(traverse);
    return activities;
  }

  /**
   * Update navigation state (simplified to prevent infinite loops)
   */
  updateNavigationState(newState) {
    // Skip empty or invalid updates
    if (!newState || Object.keys(newState).length === 0) {
      return;
    }
    
    // Remove internal flags before comparison
    const cleanNewState = { ...newState };
    delete cleanNewState._fromUIState;
    delete cleanNewState._internal;
    
    // Only update if state actually changed to prevent infinite loops
    const hasChanged = Object.keys(cleanNewState).some(key => 
      this.navigationState[key] !== cleanNewState[key]
    );
    
    if (!hasChanged) {
      return;
    }
    
    // Update state with change tracking
    const prevState = { ...this.navigationState };
    this.navigationState = { ...this.navigationState, ...cleanNewState };
    
    // Update UI elements
    this.updateButtonStates();
    this.updateMenuButton();
    
    // Emit state change event (but not back to UI state if it came from there)
    if (!newState._fromUIState && this.uiState) {
      try {
        this.uiState.updateNavigation(this.navigationState);
      } catch (error) {
        this.logger?.warn('NavigationControls: Failed to update UI state:', error?.message || error);
        // Revert state on error
        this.navigationState = prevState;
        this.updateButtonStates();
        this.updateMenuButton();
      }
    }
  }

  /**
   * Update button states based on available navigation
   */
  updateButtonStates() {
    // Check if browse mode is enabled
    const browseMode = this.uiState?.getState('browseMode')?.enabled || false;
    
    // In browse mode, enable all navigation; in normal mode, check availability
    const canNavigatePrevious = browseMode || 
      !!this.navigationState.canNavigatePrevious || 
      this.isNavigationAvailable('previous');
      
    const canNavigateNext = browseMode || 
      !!this.navigationState.canNavigateNext || 
      this.isNavigationAvailable('continue');
    
    if (this.previousBtn) {
      this.previousBtn.disabled = !canNavigatePrevious;
      this.previousBtn.classList.toggle('disabled', !canNavigatePrevious);
      
      if (browseMode) {
        this.previousBtn.title = 'Previous Activity (Browse Mode - Unrestricted Navigation)';
      } else {
        this.previousBtn.title = canNavigatePrevious ? 'Previous Activity (respects course sequencing)' : 'Previous navigation not available';
      }
      
      this.previousBtn.setAttribute('aria-disabled', String(!canNavigatePrevious));
    }
    
    if (this.nextBtn) {
      this.nextBtn.disabled = !canNavigateNext;
      this.nextBtn.classList.toggle('disabled', !canNavigateNext);
      
      if (browseMode) {
        this.nextBtn.title = 'Next Activity (Browse Mode - Unrestricted Navigation)';
      } else {
        this.nextBtn.title = canNavigateNext ? 'Next Activity (respects course sequencing)' : 'Next navigation not available';
      }
      
      this.nextBtn.setAttribute('aria-disabled', String(!canNavigateNext));
    }
    
    // Add navigation state indicators
    this.addNavigationStateIndicators();
  }

  /**
   * Update menu button
   */
  updateMenuButton() {
    if (this.menuBtn) {
      this.menuBtn.textContent = this.navigationState.menuVisible ? '✕ Hide Menu' : '📚 Course Menu';
      this.menuBtn.classList.toggle('active', this.navigationState.menuVisible);
    }
  }

  /**
   * Update navigation context display
   */
  updateNavigationContext(activityInfo = {}) {
    if (!this.contextElement) return;
    
    // Show context if we have activity information
    const hasActivity = activityInfo && (activityInfo.title || activityInfo.identifier);
    
    if (hasActivity) {
      this.contextElement.style.display = 'block';
      
      // Update position (if available)
      if (this.positionElement && activityInfo.position) {
        this.positionElement.textContent = `Activity ${activityInfo.position.current} of ${activityInfo.position.total}`;
      }
      
      // Update title
      if (this.titleDisplayElement && activityInfo.title) {
        this.titleDisplayElement.textContent = activityInfo.title;
      }
      
      // Update type
      if (this.typeElement && activityInfo.type) {
        this.typeElement.textContent = activityInfo.type.toUpperCase();
      }
    } else {
      this.contextElement.style.display = 'none';
    }
  }

  /**
   * Add navigation state indicators
   */
  addNavigationStateIndicators() {
    // Add visual indicators for navigation state
    const indicators = {
      locked: '🔒',
      forced: '⚠️',
      available: '✅',
      processing: '🔄'
    };
    
    // Update button states with indicators
    if (this.previousBtn) {
      const currentTitle = this.previousBtn.title;
      const indicator = this.navigationState.canNavigatePrevious ? indicators.available : indicators.locked;
      this.previousBtn.title = `${currentTitle} ${indicator}`;
      this.previousBtn.classList.toggle('nav-available', this.navigationState.canNavigatePrevious);
    }
    
    if (this.nextBtn) {
      const currentTitle = this.nextBtn.title;
      const indicator = this.navigationState.canNavigateNext ? indicators.available : indicators.locked;
      this.nextBtn.title = `${currentTitle} ${indicator}`;
      this.nextBtn.classList.toggle('nav-available', this.navigationState.canNavigateNext);
    }
  }

  /**
   * BUG-005 FIX: Browse mode handling now centralized in AppManager
   * This method kept for backward compatibility but delegates to centralized system
   */
  async setBrowseMode(enabled) {
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('browseMode:toggle', { enabled });
    } catch (error) {
      this.logger?.error('NavigationControls: Failed to set browse mode via centralized system', error);
    }
  }

  /**
   * Update mode toggle button states
   */
  updateModeToggle(browseModeEnabled) {
    if (this.learnerModeBtn && this.browseModeBtn) {
      this.learnerModeBtn.classList.toggle('active', !browseModeEnabled);
      this.browseModeBtn.classList.toggle('active', browseModeEnabled);
    }
  }

  /**
   * Update navigation controls for browse mode (SCORM-compliant)
   */
  updateNavigationForBrowseMode(browseModeEnabled) {
    // Update navigation controls container to show browse mode
    if (this.element) {
      this.element.classList.toggle('navigation-controls--browse', browseModeEnabled);
      this.element.classList.toggle('navigation-controls--learner', !browseModeEnabled);
    }

    // Update button labels and behavior for browse mode
    if (browseModeEnabled) {
      if (this.previousBtn) {
        this.previousBtn.title = 'Previous Activity (Browse Mode - Unrestricted Navigation)';
        this.previousBtn.classList.add('nav-browse-mode');
      }
      if (this.nextBtn) {
        this.nextBtn.title = 'Next Activity (Browse Mode - Unrestricted Navigation)';
        this.nextBtn.classList.add('nav-browse-mode');
      }

      // Show browse mode indicator
      this.showBrowseModeIndicator();
    } else {
      if (this.previousBtn) {
        this.previousBtn.title = 'Previous Activity (respects course sequencing)';
        this.previousBtn.classList.remove('nav-browse-mode');
      }
      if (this.nextBtn) {
        this.nextBtn.title = 'Next Activity (respects course sequencing)';
        this.nextBtn.classList.remove('nav-browse-mode');
      }

      // Hide browse mode indicator
      this.hideBrowseModeIndicator();
    }
    
    // Update button states to reflect browse mode navigation availability
    this.updateButtonStates();
  }

  /**
   * Refresh navigation availability from SN service
   */
  async refreshNavigationAvailability() {
    try {
      if (this.snService) {
        // Ask SN to recompute availability (especially important after mode changes)
        const refreshed = await this.snService.refreshNavigationAvailability();
        const available = refreshed && (refreshed.availableNavigation || refreshed?.availableNavigation);

        if (Array.isArray(available)) {
          // Update local state and propagate authoritative booleans to UIState
          this.updateAvailableNavigation(available);
          try {
            const normalized = this.normalizeAvailableNavigation(available);
            this.uiState?.updateNavigation({ ...normalized, _fromComponent: true });
          } catch (e) {
            this.logger?.warn('NavigationControls: Failed to push refreshed availability to UIState', e?.message || e);
          }
          this.logger?.debug('NavigationControls: Navigation availability refreshed', available);
          return { success: true, availableNavigation: available };
        }
      }
    } catch (error) {
      this.logger?.warn('NavigationControls: Failed to refresh navigation availability', error);
    }
  }

  /**
   * Show browse mode indicator (SCORM-compliant)
   */
  showBrowseModeIndicator() {
    if (this.statusElement && !this.browseModeIndicator) {
      this.browseModeIndicator = document.createElement('div');
      this.browseModeIndicator.className = 'browse-mode-indicator';
      this.browseModeIndicator.innerHTML = '🔍 Browse Mode - Data Not Tracked';

      // Insert after status element
      if (this.statusElement.parentNode) {
        this.statusElement.parentNode.insertBefore(this.browseModeIndicator, this.statusElement.nextSibling);
      }
    }

    if (this.browseModeIndicator) {
      this.browseModeIndicator.style.display = 'block';
    }
  }

  /**
   * Hide browse mode indicator
   */
  hideBrowseModeIndicator() {
    if (this.browseModeIndicator) {
      this.browseModeIndicator.style.display = 'none';
    }
  }

  /**
   * Set menu visibility
   */
  async setMenuVisible(visible) {
    this.updateNavigationState({ menuVisible: visible });
    this.emit('menuVisibilityChanged', { visible });
    
    // Also emit to global eventBus for app-manager
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('menuVisibilityChanged', { visible });
    } catch (_) {
      // Fallback - continue with component-level event
    }
  }

  /**
   * Set flow-only mode
   */
  setFlowOnlyMode(isFlowOnly) {
    this.updateNavigationState({ isFlowOnly });
    
    // Update UI to indicate flow-only mode
    this.element.classList.toggle('navigation-controls--flow-only', isFlowOnly);
    
    if (isFlowOnly) {
      this.statusElement.textContent = 'Sequential navigation course';
    }
  }

  /**
   * Show fallback mode notification
   */
  showFallbackMode(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.classList.add('navigation-controls__status--warning');
    }
    
    // Add visual indicator for fallback mode
    this.element.classList.add('navigation-controls--fallback');
    
    // Create error indicator if it doesn't exist
    if (!this.errorIndicator) {
      this.errorIndicator = document.createElement('div');
      this.errorIndicator.className = 'navigation-controls__error-indicator';
      this.errorIndicator.innerHTML = `
        <span class="error-icon">⚠️</span>
        <span class="error-text">Fallback Mode</span>
      `;
      this.element.appendChild(this.errorIndicator);
    }
    
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn('NavigationControls: Operating in fallback mode:', message);
    }
  }

  /**
   * Hide fallback mode notification
   */
  hideFallbackMode() {
    if (this.statusElement) {
      this.statusElement.classList.remove('navigation-controls__status--warning');
    }
    
    this.element.classList.remove('navigation-controls--fallback');
    
    if (this.errorIndicator) {
      this.errorIndicator.remove();
      this.errorIndicator = null;
    }
  }

  /**
   * Update title and status
   */
  updateTitleAndStatus(title, status) {
    if (this.titleElement && title) {
      this.titleElement.textContent = title;
    }
    
    if (this.statusElement && status) {
      this.statusElement.textContent = status;
    }
  }

  /**
   * Update progress display
   */
  updateProgress(progressData) {
    if (!this.progressElement || !this.progressFill || !this.progressText) return;
    
    const progress = progressData.progressMeasure || 0;
    const percentage = Math.round(progress * 100);
    
    this.progressFill.style.width = `${percentage}%`;
    this.progressText.textContent = `${percentage}%`;
    
    // Show progress if there's meaningful progress
    if (progress > 0) {
      this.progressElement.style.display = 'block';
    }
  }

  /**
   * Get content viewer reference
   */
  getContentViewer() {
    // Use event-based communication instead of direct DOM queries
    // The app manager should provide component references
    if (!this.contentViewer) {
      this.emit('contentViewerRequested');
    }
    return this.contentViewer;
  }

  /**
   * Set content viewer reference (called by app manager)
   */
  setContentViewer(contentViewer) {
    this.contentViewer = contentViewer;
  }

  /**
   * Load navigation state from UI state
   */
  loadNavigationState() {
    const state = this.uiState.getState('navigationState');
    if (state) {
      this.navigationState = { ...this.navigationState, ...state };
      this.updateButtonStates();
      this.updateMenuButton();
    }
  }

  /**
   * Handle course loaded event
   */
  async handleCourseLoaded(data) {
    this.updateTitleAndStatus('SCORM Course Player', 'Course loaded and active');
    
    // Initialize SN service for the course
    if (this.snService && data.manifest) {
      try {
        const initResult = await this.snService.initializeCourse(data.manifest, data.packageInfo);
        if (initResult.success) {
          this.logger?.debug('NavigationControls: SN service initialized for course');
          
          // Get initial sequencing state
          const sequencingState = await this.snService.getSequencingState();
          if (sequencingState.success) {
            this.updateAvailableNavigation(sequencingState.availableNavigation);
            
            // Store current activity info
            this.navigationState.currentActivity = sequencingState.currentActivity;
            this.navigationState.sequencingState = sequencingState;
          }
        }
      } catch (error) {
        this.logger?.error('NavigationControls: Failed to initialize SN service:', error);
      }
    }
    
    // Update UI to show course is ready
    this.element.classList.add('navigation-controls--course-loaded');
  }

  /**
   * Handle course cleared event
   */
  async handleCourseCleared() {
    this.updateTitleAndStatus('Learning Management System', 'No course loaded');
    
    // Reset SN service
    if (this.snService) {
      try {
        await this.snService.reset();
        this.logger?.debug('NavigationControls: SN service reset');
      } catch (error) {
        this.logger?.error('NavigationControls: Failed to reset SN service:', error);
      }
    }
    
    // Reset navigation state
    this.navigationState = {
      availableNavigation: [],
      currentActivity: null,
      sequencingState: null,
      menuVisible: false
    };
    
    this.updateButtonStates();
    this.updateMenuButton();
    
    // Update UI to show no course
    this.element.classList.remove('navigation-controls--course-loaded');
    
    if (this.progressElement) {
      this.progressElement.style.display = 'none';
    }
  }

  /**
   * Handle navigation updated event from UI state
   */
  handleNavigationUpdated(data) {
    // Prevent recursive updates
    if (data._fromNavigationControls) {
      return;
    }

    // Prevent self-triggering from navigation result processing
    if (data._fromNavigationResult) {
      this.logger?.debug('NavigationControls: Skipping navigation update from own result');
      return;
    }

    // Add simple deduplication to prevent redundant updates
    const currentState = this.navigationState;
    const navData = data.data || data;

    // Check if the navigation state actually changed
    const hasChanged = !currentState ||
      currentState.canNavigatePrevious !== navData.canNavigatePrevious ||
      currentState.canNavigateNext !== navData.canNavigateNext ||
      currentState.currentItem !== navData.currentItem;

    if (!hasChanged) {
      return; // No change, skip update
    }

    // Extract actual data and mark as from UI state
    const stateUpdate = { ...navData, _fromUIState: true };

    this.updateNavigationState(stateUpdate);
  }


  /**
   * Handle progress updated event
   */
  handleProgressUpdated(data) {
    this.updateProgress(data);
  }

  /**
   * Handle SCORM initialized event
   */
  handleScormInitialized(_data) {
    this.updateTitleAndStatus(null, 'SCORM session active');
  }

  /**
   * Handle SCORM data changed event
   */
  handleScormDataChanged(data) {
    const { element, value } = data.data || data;

    // Update progress indicators reactively when SCORM data changes
    if (element === 'cmi.completion_status') {
      this.updateCompletionStatus(value);
    } else if (element === 'cmi.progress_measure') {
      this.updateProgressMeasure(value);
    } else if (element === 'cmi.success_status') {
      this.updateSuccessStatus(value);
    }

    // Update overall progress display if any relevant data changed
    if (['cmi.completion_status', 'cmi.progress_measure', 'cmi.success_status'].includes(element)) {
      const progressData = this.uiState?.getState('progressData');
      if (progressData) {
        this.updateProgress(progressData);
      }
    }
  }

  /**
   * Update completion status display
   */
  updateCompletionStatus(status) {
    // Update any completion status indicators in the navigation bar
    const statusElement = this.find('.navigation-controls__status');
    if (statusElement && status) {
      // Keep existing status text but ensure progress is reflected
      const currentText = statusElement.textContent;
      if (currentText && !currentText.includes('No course')) {
        // Update status to reflect current completion
        const statusText = status === 'completed' ? 'Course Completed' :
                          status === 'incomplete' ? 'Course In Progress' :
                          'Course Status: ' + status;
        statusElement.textContent = statusText;
      }
    }
  }

  /**
   * Update progress measure display
   */
  updateProgressMeasure(measure) {
    if (typeof measure === 'number' && measure >= 0 && measure <= 1) {
      // Update progress bar if visible
      if (this.progressFill && this.progressText) {
        const percentage = Math.round(measure * 100);
        this.progressFill.style.width = `${percentage}%`;
        this.progressText.textContent = `${percentage}%`;
      }
    }
  }

  /**
   * Update success status display
   */
  updateSuccessStatus(_status) {
    // Could add success status indicator if needed
    // For now, this ensures success status changes trigger progress updates
  }

  /**
   * Handle UI updated event
   */
  handleUIUpdated(data) {
    if (data.loading !== undefined) {
      this.element.classList.toggle('navigation-controls--loading', data.loading);
    }
  }

  /**
   * BUG-022 FIX: Handle navigation state updates from AppManager
   */
  handleNavigationStateUpdate(stateData) {
    try {
      const { state, currentRequest } = stateData || {};
      
      // Update button states based on navigation state
      if (state === 'PROCESSING') {
        this.element.classList.add('navigation-controls--processing');
        // Disable buttons during processing
        this.setButtonEnabled('previous', false);
        this.setButtonEnabled('continue', false);
      } else {
        this.element.classList.remove('navigation-controls--processing');
        // Re-enable buttons based on available navigation
        this.updateButtonStates();
      }
      
      this.logger?.debug('NavigationControls: Updated for navigation state change', { state, requestType: currentRequest?.requestType });
    } catch (error) {
      this.logger?.error('NavigationControls: Error handling navigation state update', error);
    }
  }

  /**
   * Destroy component
   */
  destroy() {
    if (typeof this._unsubscribeNav === 'function') {
      try { this._unsubscribeNav(); } catch (e) { this.logger?.warn('NavigationControls: Error unsubscribing from UIState', e?.message || e); }
      this._unsubscribeNav = null;
    }

    if (typeof this._unsubscribeBrowseMode === 'function') {
      try { this._unsubscribeBrowseMode(); } catch (e) { this.logger?.warn('NavigationControls: Error unsubscribing from browse mode state', e?.message || e); }
      this._unsubscribeBrowseMode = null;
    }
    // Remove listeners with the same bound references to avoid leaks
    if (this.options.enableKeyboardNavigation && this._boundHandlers && this._boundHandlers.handleKeyDown) {
      document.removeEventListener('keydown', this._boundHandlers.handleKeyDown);
    }
    if (this.previousBtn && this._boundHandlers && this._boundHandlers.handlePreviousClick) {
      this.previousBtn.removeEventListener('click', this._boundHandlers.handlePreviousClick);
    }
    if (this.nextBtn && this._boundHandlers && this._boundHandlers.handleNextClick) {
      this.nextBtn.removeEventListener('click', this._boundHandlers.handleNextClick);
    }
    // Menu button uses direct arrow function, no cleanup needed
    if (this.learnerModeBtn && this._boundHandlers && this._boundHandlers.handleLearnerModeClick) {
      this.learnerModeBtn.removeEventListener('click', this._boundHandlers.handleLearnerModeClick);
    }
    if (this.browseModeBtn && this._boundHandlers && this._boundHandlers.handleBrowseModeClick) {
      this.browseModeBtn.removeEventListener('click', this._boundHandlers.handleBrowseModeClick);
    }
    super.destroy();
  }

  /**
   * Normalize availableNavigation array into booleans used as single source of truth.
   * This is the authoritative source for enabling/disabling flow (Prev/Next) buttons.
   * SCORM distinguishes between 'flow' (continue, previous) and 'choice' navigation.
   * The main navigation buttons should only handle flow navigation.
   */
  normalizeAvailableNavigation(availableNavigation = []) {
    const a = Array.isArray(availableNavigation) ? availableNavigation : [];
    // Strict adherence to flow navigation requests. 'choice' is handled by outline/menu components.
    const canNavigatePrevious = a.includes('previous');
    const canNavigateNext = a.includes('continue');
    return { canNavigatePrevious, canNavigateNext };
  }

  /**
   * Normalize UIState navigationState payload into this component's shape.
   */
  normalizeNavStateFromUI(navState = {}) {
    // Trust booleans when supplied; retain local availableNavigation list if UIState doesn't send it
    const normalized = {
      canNavigatePrevious: !!navState.canNavigatePrevious,
      canNavigateNext: !!navState.canNavigateNext
    };
    return normalized;
  }
}

export { NavigationControls };
