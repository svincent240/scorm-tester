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
      availableNavigation: [],
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
            <button class="mode-btn mode-btn--testing" id="${this.elementId}-testing-mode">🔧 Testing Mode</button>
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
    this.testingModeBtn = this.find('.mode-btn--testing');
    
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
    this.subscribe('navigation:request', this.handleNavigationRequest);
    
    // Listen for progress events
    this.subscribe('progress:updated', this.handleProgressUpdated);
    
    // Listen for SCORM events
    this.subscribe('scorm:initialized', this.handleScormInitialized);
    this.subscribe('scorm:dataChanged', this.handleScormDataChanged);
    
    // Listen for UI events
    this.subscribe('ui:updated', this.handleUIUpdated);
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
        handleMenuClick: this.handleMenuClick.bind(this),
        handleLearnerModeClick: this.handleLearnerModeClick.bind(this),
        handleTestingModeClick: this.handleTestingModeClick.bind(this),
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
    
    if (this.menuBtn && this._boundHandlers.handleMenuClick) {
      this.menuBtn.addEventListener('click', this._boundHandlers.handleMenuClick);
    }
    
    // Mode toggle button event listeners
    if (this.learnerModeBtn && this._boundHandlers.handleLearnerModeClick) {
      this.learnerModeBtn.addEventListener('click', this._boundHandlers.handleLearnerModeClick);
    }
    
    if (this.testingModeBtn && this._boundHandlers.handleTestingModeClick) {
      this.testingModeBtn.addEventListener('click', this._boundHandlers.handleTestingModeClick);
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
    if (!this.isNavigationAvailable('previous')) return;

    // Emit centralized intent for AppManager orchestration
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('navigation:request', { type: 'previous', source: 'navigation-controls' });
    } catch (_) {
      // fall through; component-local behavior remains
    }
    
    this.emit('navigationRequested', { direction: 'previous' });
    await this.processNavigation('previous');
  }

  /**
   * Handle next button click
   */
  async handleNextClick() {
    if (!this.isNavigationAvailable('continue')) return;

    // Emit centralized intent for AppManager orchestration
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('navigation:request', { type: 'continue', source: 'navigation-controls' });
    } catch (_) {
      // fall through; component-local behavior remains
    }
    
    this.emit('navigationRequested', { direction: 'next' });
    await this.processNavigation('continue');
  }

  /**
   * Handle menu button click
   */
  async handleMenuClick() {
    const newState = !this.navigationState.menuVisible;
    this.setMenuVisible(newState);
    this.emit('menuToggled', { visible: newState });
    
    // Also emit to global eventBus for app-manager
    try {
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('menuToggled', { visible: newState });
    } catch (_) {
      // Fallback - continue with component-level event
    }
  }

  /**
   * Handle learner mode button click
   */
  async handleLearnerModeClick() {
    await this.setTestingMode(false);
  }

  /**
   * Handle testing mode button click
   */
  async handleTestingModeClick() {
    await this.setTestingMode(true);
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
      if (!this.snService) {
        this.logger?.warn('NavigationControls: SN service not available, falling back to content navigation');
        return this.fallbackContentNavigation(navigationRequest);
      }

      this.logger?.debug(`NavigationControls: Processing navigation request: ${navigationRequest}`);
      
      // Use main process SN service for proper SCORM navigation
      const result = await this.snService.processNavigation(navigationRequest, targetActivityId);
      
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
    if (result.targetActivity && result.action === 'launch') {
      // Load new activity content
      this.emit('activityLaunchRequested', {
        activity: result.targetActivity,
        sequencing: result.sequencing
      });
      // Broadcast centralized launch intent for other listeners
      try {
        const { eventBus } = await import('../../services/event-bus.js');
        eventBus.emit('navigation:launch', {
          activity: result.targetActivity,
          sequencing: result.sequencing,
          source: 'navigation-controls'
        });
      } catch (_) { /* no-op */ }
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
      try {
        const { eventBus } = await import('../../services/event-bus.js');
        eventBus.emit('navigation:updated', {
          ...normalized,
          source: 'navigation-controls'
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
  fallbackContentNavigation(navigationRequest) {
    const contentViewer = this.getContentViewer();
    if (!contentViewer) {
      this.logger?.warn('NavigationControls: No content viewer available for fallback navigation');
      return { success: false, reason: 'No content viewer available' };
    }
    
    const contentWindow = contentViewer.getContentWindow();
    if (!contentWindow) {
      this.logger?.warn('NavigationControls: No content window available for fallback navigation');
      return { success: false, reason: 'No content window available' };
    }
    
    try {
      const direction = navigationRequest === 'continue' ? 'next' : navigationRequest;
      const success = this.tryContentNavigation(contentWindow, direction);
      
      return {
        success,
        reason: success ? `Fallback ${direction} navigation succeeded` : `Fallback ${direction} navigation failed`,
        fallback: true
      };
    } catch (error) {
      this.logger?.error('NavigationControls: Fallback navigation error:', error);
      return { success: false, reason: 'Fallback navigation error', error: error.message };
    }
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
   * Try generic button navigation (simplified)
   */
  tryGenericButtonNavigation(contentDocument, direction) {
    const selectors = direction === 'next' ? 
      ['.next-btn', '.btn-next', '.continue'] : 
      ['.prev-btn', '.btn-prev', '.previous', '.back'];
    
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
    // Use authoritative booleans from UIState-normalized data when present
    const canNavigatePrevious = !!this.navigationState.canNavigatePrevious || this.isNavigationAvailable('previous');
    const canNavigateNext = !!this.navigationState.canNavigateNext || this.isNavigationAvailable('continue');
    
    if (this.previousBtn) {
      this.previousBtn.disabled = !canNavigatePrevious;
      this.previousBtn.classList.toggle('disabled', !canNavigatePrevious);
      this.previousBtn.title = canNavigatePrevious ? 'Previous Activity (respects course sequencing)' : 'Previous navigation not available';
      this.previousBtn.setAttribute('aria-disabled', String(!canNavigatePrevious));
    }
    
    if (this.nextBtn) {
      this.nextBtn.disabled = !canNavigateNext;
      this.nextBtn.classList.toggle('disabled', !canNavigateNext);
      this.nextBtn.title = canNavigateNext ? 'Next Activity (respects course sequencing)' : 'Next navigation not available';
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
    if (this.previousBtn && this.navigationState.canNavigatePrevious) {
      this.previousBtn.classList.add('nav-available');
    }
    
    if (this.nextBtn && this.navigationState.canNavigateNext) {
      this.nextBtn.classList.add('nav-available');
    }
  }

  /**
   * Set testing mode
   */
  async setTestingMode(enabled) {
    try {
      // Update UI state
      if (this.uiState) {
        const currentTestingMode = this.uiState.getState('testingMode') || {};
        const newTestingMode = {
          ...currentTestingMode,
          enabled: enabled
        };
        this.uiState.setState('testingMode', newTestingMode);
      }
      
      // Update mode toggle buttons
      this.updateModeToggle(enabled);
      
      // Update navigation controls display based on mode
      this.updateNavigationForTestingMode(enabled);
      
      // Emit mode change event
      const { eventBus } = await import('../../services/event-bus.js');
      eventBus.emit('testingMode:changed', { enabled });
      
      this.logger?.info('NavigationControls: Testing mode changed', { enabled });
      
    } catch (error) {
      this.logger?.error('NavigationControls: Failed to set testing mode', error);
    }
  }

  /**
   * Update mode toggle button states
   */
  updateModeToggle(testingModeEnabled) {
    if (this.learnerModeBtn && this.testingModeBtn) {
      this.learnerModeBtn.classList.toggle('active', !testingModeEnabled);
      this.testingModeBtn.classList.toggle('active', testingModeEnabled);
    }
  }

  /**
   * Update navigation controls for testing mode
   */
  updateNavigationForTestingMode(testingModeEnabled) {
    // Update navigation controls container to show testing mode
    if (this.element) {
      this.element.classList.toggle('navigation-controls--testing', testingModeEnabled);
      this.element.classList.toggle('navigation-controls--learner', !testingModeEnabled);
    }
    
    // Update button labels and behavior for testing mode
    if (testingModeEnabled) {
      if (this.previousBtn) {
        this.previousBtn.title = 'Previous Activity (TESTING MODE - Can override sequencing)';
        this.previousBtn.classList.add('nav-testing-mode');
      }
      if (this.nextBtn) {
        this.nextBtn.title = 'Next Activity (TESTING MODE - Can override sequencing)';
        this.nextBtn.classList.add('nav-testing-mode');
      }
      
      // Show testing mode indicator
      this.showTestingModeIndicator();
    } else {
      if (this.previousBtn) {
        this.previousBtn.title = 'Previous Activity (respects course sequencing)';
        this.previousBtn.classList.remove('nav-testing-mode');
      }
      if (this.nextBtn) {
        this.nextBtn.title = 'Next Activity (respects course sequencing)';
        this.nextBtn.classList.remove('nav-testing-mode');
      }
      
      // Hide testing mode indicator
      this.hideTestingModeIndicator();
    }
  }

  /**
   * Show testing mode indicator
   */
  showTestingModeIndicator() {
    if (this.statusElement && !this.testingModeIndicator) {
      this.testingModeIndicator = document.createElement('div');
      this.testingModeIndicator.className = 'testing-mode-indicator';
      this.testingModeIndicator.innerHTML = '🔧 TESTING MODE - Sequencing Rules Can Be Overridden';
      
      // Insert after status element
      if (this.statusElement.parentNode) {
        this.statusElement.parentNode.insertBefore(this.testingModeIndicator, this.statusElement.nextSibling);
      }
    }
    
    if (this.testingModeIndicator) {
      this.testingModeIndicator.style.display = 'block';
    }
  }

  /**
   * Hide testing mode indicator
   */
  hideTestingModeIndicator() {
    if (this.testingModeIndicator) {
      this.testingModeIndicator.style.display = 'none';
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
    
    // Extract actual data and mark as from UI state
    const navData = data.data || data;
    const stateUpdate = { ...navData, _fromUIState: true };
    
    this.updateNavigationState(stateUpdate);
  }

  /**
   * Handle navigation request event
   */
  handleNavigationRequest(data) {
    if (data.direction === 'previous') {
      this.navigatePrevious();
    } else if (data.direction === 'next') {
      this.navigateNext();
    }
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
  handleScormInitialized(data) {
    this.updateTitleAndStatus(null, 'SCORM session active');
  }

  /**
   * Handle SCORM data changed event
   */
  handleScormDataChanged(data) {
    // Update progress if completion status changed
    if (data.element === 'cmi.completion_status' || data.element === 'cmi.progress_measure') {
      const progressData = this.uiState.getState('progressData');
      if (progressData) {
        this.updateProgress(progressData);
      }
    }
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
   * Destroy component
   */
  destroy() {
    if (typeof this._unsubscribeNav === 'function') {
      try { this._unsubscribeNav(); } catch (_) {}
      this._unsubscribeNav = null;
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
    if (this.menuBtn && this._boundHandlers && this._boundHandlers.handleMenuClick) {
      this.menuBtn.removeEventListener('click', this._boundHandlers.handleMenuClick);
    }
    if (this.learnerModeBtn && this._boundHandlers && this._boundHandlers.handleLearnerModeClick) {
      this.learnerModeBtn.removeEventListener('click', this._boundHandlers.handleLearnerModeClick);
    }
    if (this.testingModeBtn && this._boundHandlers && this._boundHandlers.handleTestingModeClick) {
      this.testingModeBtn.removeEventListener('click', this._boundHandlers.handleTestingModeClick);
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