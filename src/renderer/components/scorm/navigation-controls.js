/**
 * Navigation Controls Component
 * 
 * Provides LMS-style navigation bar with Previous/Next buttons,
 * menu toggle, and navigation state management. Handles both
 * flow-only and choice navigation courses.
 * 
 * @fileoverview SCORM navigation controls component
 */

import { BaseComponent } from '../base-component.js';
import { uiState } from '../../services/ui-state.js';
import { scormClient } from '../../services/scorm-client.js';

/**
 * Navigation Controls Class
 * 
 * Manages LMS-style navigation with Previous/Next buttons,
 * course outline toggle, and navigation state coordination.
 */
class NavigationControls extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.navigationState = {
      canNavigatePrevious: false,
      canNavigateNext: false,
      currentItem: null,
      isFlowOnly: false,
      menuVisible: false
    };
    
    this.contentViewer = null;
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
    this.loadNavigationState();
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
          <button 
            class="navigation-controls__btn navigation-controls__btn--previous" 
            id="${this.elementId}-previous"
            disabled
            title="Previous"
          >
            ← Previous
          </button>
          
          <button 
            class="navigation-controls__btn navigation-controls__btn--next" 
            id="${this.elementId}-next"
            disabled
            title="Next"
          >
            Next →
          </button>
          
          <button 
            class="navigation-controls__btn navigation-controls__btn--menu" 
            id="${this.elementId}-menu"
            title="Toggle Course Menu"
          >
            ☰ Menu
          </button>
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
    
    if (this.previousBtn) {
      this.previousBtn.addEventListener('click', this.handlePreviousClick);
    }
    
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', this.handleNextClick);
    }
    
    if (this.menuBtn) {
      this.menuBtn.addEventListener('click', this.handleMenuClick);
    }
    
    // Keyboard navigation
    if (this.options.enableKeyboardNavigation) {
      document.addEventListener('keydown', this.handleKeyDown);
    }
  }

  /**
   * Handle previous button click
   */
  handlePreviousClick() {
    if (!this.navigationState.canNavigatePrevious) return;
    
    this.emit('navigationRequested', { direction: 'previous' });
    this.navigatePrevious();
  }

  /**
   * Handle next button click
   */
  handleNextClick() {
    if (!this.navigationState.canNavigateNext) return;
    
    this.emit('navigationRequested', { direction: 'next' });
    this.navigateNext();
  }

  /**
   * Handle menu button click
   */
  handleMenuClick() {
    const newState = !this.navigationState.menuVisible;
    this.setMenuVisible(newState);
    this.emit('menuToggled', { visible: newState });
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
   * Navigate to previous content
   */
  navigatePrevious() {
    const contentViewer = this.getContentViewer();
    if (!contentViewer) return;
    
    const contentWindow = contentViewer.getContentWindow();
    if (!contentWindow) return;
    
    const isFlowOnly = this.navigationState.isFlowOnly;
    
    try {
      if (isFlowOnly) {
        // For flow-only courses, let the course handle navigation
        this.tryContentNavigation(contentWindow, 'previous');
      } else {
        // For choice navigation courses, use SCORM navigation requests
        this.tryScormNavigation('previous');
      }
    } catch (error) {
      console.error('Navigation error:', error);
      this.emit('navigationError', { direction: 'previous', error });
    }
  }

  /**
   * Navigate to next content
   */
  navigateNext() {
    const contentViewer = this.getContentViewer();
    if (!contentViewer) return;
    
    const contentWindow = contentViewer.getContentWindow();
    if (!contentWindow) return;
    
    const isFlowOnly = this.navigationState.isFlowOnly;
    
    try {
      if (isFlowOnly) {
        // For flow-only courses, let the course handle navigation
        this.tryContentNavigation(contentWindow, 'next');
      } else {
        // For choice navigation courses, use SCORM navigation requests
        this.tryScormNavigation('next');
      }
    } catch (error) {
      console.error('Navigation error:', error);
      this.emit('navigationError', { direction: 'next', error });
    }
  }

  /**
   * Try content-based navigation (for flow-only courses)
   */
  tryContentNavigation(contentWindow, direction) {
    const contentDocument = contentWindow.document;
    
    // Try Storyline navigation
    if (this.tryStorylineNavigation(contentWindow, direction)) {
      return true;
    }
    
    // Try Captivate navigation
    if (this.tryCaptivateNavigation(contentWindow, direction)) {
      return true;
    }
    
    // Try generic button navigation
    if (this.tryGenericButtonNavigation(contentDocument, direction)) {
      return true;
    }
    
    // Try keyboard navigation as fallback
    this.tryKeyboardNavigation(contentDocument, direction);
    
    return false;
  }

  /**
   * Try Storyline navigation
   */
  tryStorylineNavigation(contentWindow, direction) {
    try {
      if (contentWindow.GetPlayer) {
        const player = contentWindow.GetPlayer();
        if (direction === 'next' && player.NextSlide) {
          player.NextSlide();
          return true;
        } else if (direction === 'previous' && player.PrevSlide) {
          player.PrevSlide();
          return true;
        }
      }
      
      if (contentWindow.parent && contentWindow.parent.GetPlayer) {
        const player = contentWindow.parent.GetPlayer();
        if (direction === 'next' && player.NextSlide) {
          player.NextSlide();
          return true;
        } else if (direction === 'previous' && player.PrevSlide) {
          player.PrevSlide();
          return true;
        }
      }
    } catch (error) {
      // Continue to other methods
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
      // Continue to other methods
    }
    
    return false;
  }

  /**
   * Try generic button navigation
   */
  tryGenericButtonNavigation(contentDocument, direction) {
    const buttonSelectors = direction === 'next' ? [
      'button[title*="next" i]', 'button[aria-label*="next" i]',
      'button[id*="next" i]', 'button[class*="next" i]',
      '.next-btn', '.btn-next', '.continue', '.forward',
      'input[type="button"][value*="next" i]'
    ] : [
      'button[title*="previous" i]', 'button[aria-label*="previous" i]',
      'button[id*="prev" i]', 'button[class*="prev" i]',
      '.prev-btn', '.btn-prev', '.previous', '.back',
      'input[type="button"][value*="previous" i]'
    ];
    
    for (const selector of buttonSelectors) {
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
   * Try keyboard navigation
   */
  tryKeyboardNavigation(contentDocument, direction) {
    try {
      const keyCode = direction === 'next' ? 'ArrowRight' : 'ArrowLeft';
      const event = new contentDocument.defaultView.KeyboardEvent('keydown', {
        key: keyCode,
        code: keyCode,
        bubbles: true,
        cancelable: true
      });
      
      contentDocument.dispatchEvent(event);
    } catch (error) {
      // Keyboard navigation failed
    }
  }

  /**
   * Try SCORM navigation (for choice navigation courses)
   */
  tryScormNavigation(direction) {
    const navRequest = direction === 'next' ? 'continue' : 'previous';
    
    try {
      scormClient.SetValue('adl.nav.request', navRequest);
      scormClient.Commit('');
      return true;
    } catch (error) {
      console.error('SCORM navigation failed:', error);
      return false;
    }
  }

  /**
   * Update navigation state
   */
  updateNavigationState(newState) {
    console.log('NavigationControls: updateNavigationState called with:', newState);
    this.navigationState = { ...this.navigationState, ...newState };
    this.updateButtonStates();
    this.updateMenuButton();
    
    console.log('NavigationControls: Calling uiState.updateNavigation');
    uiState.updateNavigation(this.navigationState);
  }

  /**
   * Update button states
   */
  updateButtonStates() {
    if (this.previousBtn) {
      this.previousBtn.disabled = !this.navigationState.canNavigatePrevious;
      this.previousBtn.classList.toggle('disabled', !this.navigationState.canNavigatePrevious);
    }
    
    if (this.nextBtn) {
      this.nextBtn.disabled = !this.navigationState.canNavigateNext;
      this.nextBtn.classList.toggle('disabled', !this.navigationState.canNavigateNext);
    }
  }

  /**
   * Update menu button
   */
  updateMenuButton() {
    if (this.menuBtn) {
      this.menuBtn.textContent = this.navigationState.menuVisible ? '✕ Close' : '☰ Menu';
      this.menuBtn.classList.toggle('active', this.navigationState.menuVisible);
    }
  }

  /**
   * Set menu visibility
   */
  setMenuVisible(visible) {
    this.updateNavigationState({ menuVisible: visible });
    this.emit('menuVisibilityChanged', { visible });
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
    if (!this.contentViewer) {
      // Try to find content viewer component
      this.contentViewer = document.querySelector('[data-component="content-viewer"]');
    }
    return this.contentViewer;
  }

  /**
   * Load navigation state from UI state
   */
  loadNavigationState() {
    const state = uiState.getState('navigationState');
    if (state) {
      this.navigationState = { ...this.navigationState, ...state };
      this.updateButtonStates();
      this.updateMenuButton();
    }
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(data) {
    this.updateTitleAndStatus('SCORM Course Player', 'Course loaded and active');
    
    // Determine if flow-only course
    const isFlowOnly = data.structure && data.structure.isFlowOnly;
    this.setFlowOnlyMode(isFlowOnly);
    
    // Enable navigation
    this.updateNavigationState({
      canNavigatePrevious: true,
      canNavigateNext: true
    });
  }

  /**
   * Handle course cleared event
   */
  handleCourseCleared() {
    this.updateTitleAndStatus('Learning Management System', 'No course loaded');
    this.updateNavigationState({
      canNavigatePrevious: false,
      canNavigateNext: false,
      menuVisible: false
    });
    
    if (this.progressElement) {
      this.progressElement.style.display = 'none';
    }
  }

  /**
   * Handle navigation updated event
   */
  handleNavigationUpdated(data) {
    console.log('NavigationControls: handleNavigationUpdated called with:', data);
    console.log('NavigationControls: Current navigation state:', this.navigationState);
    
    // CRITICAL FIX: Update local state without triggering uiState.updateNavigation()
    // to prevent infinite loop
    this.navigationState = { ...this.navigationState, ...data };
    this.updateButtonStates();
    this.updateMenuButton();
    
    console.log('NavigationControls: Updated local navigation state without triggering event');
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
      const progressData = uiState.getState('progressData');
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
    if (this.options.enableKeyboardNavigation) {
      document.removeEventListener('keydown', this.handleKeyDown);
    }
    
    super.destroy();
  }
}

export { NavigationControls };