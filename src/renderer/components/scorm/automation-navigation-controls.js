/**
 * Automation Navigation Controls Component
 * 
 * Provides slide-based navigation controls for courses that expose the
 * window.SCORMAutomation API. This is DISTINCT from SCORM sequencing
 * navigation (NavigationControls) which handles multi-SCO courses.
 * 
 * Features:
 * - Slide dropdown selector
 * - Previous/Next slide buttons
 * - Current slide indicator
 * - Auto-hide when automation API not available
 * 
 * @fileoverview Template automation navigation component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { ipcClient } from '../../services/ipc-client.js';

/**
 * Automation Navigation Controls Class
 * 
 * Manages slide-based navigation UI for courses with automation API support.
 * Completely separate from SCORM sequencing-based navigation.
 */
class AutomationNavigationControls extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);

    this.automationState = {
      available: false,
      structure: null,
      currentSlide: null,
      sessionId: null,
      version: null,
      lastError: null
    };

    this.slideList = [];
    this.currentSlideIndex = -1;
  }

  /**
   * Get default options
   */
  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'automation-navigation-controls',
      showTitle: true,
      enableKeyboardNavigation: true,
      attributes: {
        'data-component': 'automation-navigation-controls'
      }
    };
  }

  /**
   * Setup component
   */
  async setup() {
    this.uiState = await uiStatePromise;
    
    // Initialize logger
    try {
      const { rendererLogger } = await import('../../utils/renderer-logger.js');
      this.logger = rendererLogger || null;
    } catch (_) {
      this.logger = null;
    }

    // Subscribe to automation state changes
    this._unsubscribeAutomation = this.uiState.subscribe((automationState) => {
      this.handleAutomationStateChange(automationState);
    }, 'automation');

    // Load initial automation state
    const initialState = this.uiState.getState('automation');
    if (initialState) {
      this.handleAutomationStateChange(initialState);
    }
  }

  /**
   * Render component content
   */
  renderContent() {
    this.element.innerHTML = `
      <div class="automation-nav__container" style="display: none;">
        <div class="automation-nav__header">
          <span class="automation-nav__icon">🎯</span>
          <span class="automation-nav__title">Slide Navigation</span>
          <span class="automation-nav__version" id="${this.elementId}-version"></span>
        </div>
        
        <div class="automation-nav__controls">
          <button 
            class="automation-nav__btn automation-nav__btn--prev" 
            id="${this.elementId}-prev"
            disabled
            title="Previous Slide"
          >
            ←
          </button>
          
          <div class="automation-nav__selector">
            <select 
              class="automation-nav__dropdown" 
              id="${this.elementId}-dropdown"
              disabled
            >
              <option value="">No slides available</option>
            </select>
            <span class="automation-nav__position" id="${this.elementId}-position">
              - of -
            </span>
          </div>
          
          <button 
            class="automation-nav__btn automation-nav__btn--next" 
            id="${this.elementId}-next"
            disabled
            title="Next Slide"
          >
            →
          </button>
        </div>
        
        <div class="automation-nav__status" id="${this.elementId}-status">
          <span class="automation-nav__current" id="${this.elementId}-current"></span>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const prevBtn = this.find(`#${this.elementId}-prev`);
    const nextBtn = this.find(`#${this.elementId}-next`);
    const dropdown = this.find(`#${this.elementId}-dropdown`);

    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.handlePreviousSlide());
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.handleNextSlide());
    }

    if (dropdown) {
      dropdown.addEventListener('change', (e) => this.handleSlideSelect(e.target.value));
    }

    // Keyboard shortcuts (when component is visible)
    this._keyboardHandler = (e) => {
      if (!this.automationState.available) return;
      
      // Alt+Left: Previous slide
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.handlePreviousSlide();
      }
      // Alt+Right: Next slide
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.handleNextSlide();
      }
    };

    document.addEventListener('keydown', this._keyboardHandler);
  }

  /**
   * Handle automation state change from UIState
   */
  handleAutomationStateChange(automationState) {
    if (!automationState) return;

    const wasAvailable = this.automationState.available;
    this.automationState = { ...automationState };

    // Update visibility
    const container = this.element.querySelector('.automation-nav__container');
    if (container) {
      if (this.automationState.available && this.automationState.structure) {
        container.style.display = 'flex';
        this.parseStructure();
        this.updateUI();
      } else {
        container.style.display = 'none';
      }
    }

    // Log availability changes
    if (this.automationState.available !== wasAvailable) {
      if (this.automationState.available) {
        this.logger?.info('AutomationNavigationControls: Automation API now available', {
          version: this.automationState.version,
          slideCount: this.slideList.length
        });
      } else {
        this.logger?.info('AutomationNavigationControls: Automation API unavailable');
      }
    }
  }

  /**
   * Parse course structure to extract slide list
   */
  parseStructure() {
    this.slideList = [];
    
    if (!this.automationState.structure) return;

    const structure = this.automationState.structure;

    // Handle different structure formats
    if (Array.isArray(structure)) {
      // Array of slides: [{id, title}, ...]
      this.slideList = structure.map(slide => ({
        id: slide.id || slide.slideId || slide.name,
        title: slide.title || slide.name || slide.id,
        type: slide.type || 'slide'
      }));
    } else if (structure.slides && Array.isArray(structure.slides)) {
      // Structure with slides property
      this.slideList = structure.slides.map(slide => ({
        id: slide.id || slide.slideId || slide.name,
        title: slide.title || slide.name || slide.id,
        type: slide.type || 'slide'
      }));
    } else if (structure.sections && Array.isArray(structure.sections)) {
      // Nested structure with sections
      structure.sections.forEach(section => {
        if (section.slides && Array.isArray(section.slides)) {
          section.slides.forEach(slide => {
            this.slideList.push({
              id: slide.id || slide.slideId || slide.name,
              title: `${section.title || section.name}: ${slide.title || slide.name}`,
              type: slide.type || 'slide',
              section: section.id || section.name
            });
          });
        }
      });
    }

    // Update current slide index
    if (this.automationState.currentSlide) {
      this.currentSlideIndex = this.slideList.findIndex(
        slide => slide.id === this.automationState.currentSlide
      );
    }
  }

  /**
   * Update UI elements
   */
  updateUI() {
    this.updateVersion();
    this.updateDropdown();
    this.updatePosition();
    this.updateButtons();
    this.updateStatus();
  }

  /**
   * Update version display
   */
  updateVersion() {
    const versionEl = this.find(`#${this.elementId}-version`);
    if (versionEl && this.automationState.version) {
      versionEl.textContent = `v${this.automationState.version}`;
      versionEl.style.display = 'inline';
    } else if (versionEl) {
      versionEl.style.display = 'none';
    }
  }

  /**
   * Update dropdown with slide list
   */
  updateDropdown() {
    const dropdown = this.find(`#${this.elementId}-dropdown`);
    if (!dropdown) return;

    dropdown.innerHTML = '';

    if (this.slideList.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No slides available';
      dropdown.appendChild(option);
      dropdown.disabled = true;
      return;
    }

    this.slideList.forEach((slide, index) => {
      const option = document.createElement('option');
      option.value = slide.id;
      option.textContent = `${index + 1}. ${slide.title}`;
      
      if (slide.id === this.automationState.currentSlide) {
        option.selected = true;
      }
      
      dropdown.appendChild(option);
    });

    dropdown.disabled = false;
  }

  /**
   * Update position indicator
   */
  updatePosition() {
    const positionEl = this.find(`#${this.elementId}-position`);
    if (!positionEl) return;

    if (this.currentSlideIndex >= 0 && this.slideList.length > 0) {
      positionEl.textContent = `${this.currentSlideIndex + 1} of ${this.slideList.length}`;
    } else {
      positionEl.textContent = '- of -';
    }
  }

  /**
   * Update button states
   */
  updateButtons() {
    const prevBtn = this.find(`#${this.elementId}-prev`);
    const nextBtn = this.find(`#${this.elementId}-next`);

    if (prevBtn) {
      prevBtn.disabled = this.currentSlideIndex <= 0 || this.slideList.length === 0;
    }

    if (nextBtn) {
      nextBtn.disabled = 
        this.currentSlideIndex >= this.slideList.length - 1 || 
        this.slideList.length === 0;
    }
  }

  /**
   * Update status display
   */
  updateStatus() {
    const statusEl = this.find(`#${this.elementId}-current`);
    if (!statusEl) return;

    if (this.currentSlideIndex >= 0 && this.slideList[this.currentSlideIndex]) {
      const slide = this.slideList[this.currentSlideIndex];
      statusEl.textContent = slide.title;
    } else {
      statusEl.textContent = 'No slide selected';
    }
  }

  /**
   * Handle previous slide navigation
   */
  async handlePreviousSlide() {
    if (this.currentSlideIndex <= 0) return;

    const targetIndex = this.currentSlideIndex - 1;
    const targetSlide = this.slideList[targetIndex];
    
    if (targetSlide) {
      await this.navigateToSlide(targetSlide.id);
    }
  }

  /**
   * Handle next slide navigation
   */
  async handleNextSlide() {
    if (this.currentSlideIndex >= this.slideList.length - 1) return;

    const targetIndex = this.currentSlideIndex + 1;
    const targetSlide = this.slideList[targetIndex];
    
    if (targetSlide) {
      await this.navigateToSlide(targetSlide.id);
    }
  }

  /**
   * Handle slide selection from dropdown
   */
  async handleSlideSelect(slideId) {
    if (!slideId) return;
    await this.navigateToSlide(slideId);
  }

  /**
   * Navigate to specific slide using automation API
   */
  async navigateToSlide(slideId) {
    if (!this.automationState.sessionId) {
      this.logger?.warn('AutomationNavigationControls: Cannot navigate - no session ID');
      return;
    }

    try {
      this.logger?.info('AutomationNavigationControls: Navigating to slide', { slideId });

      const result = await ipcClient.automationNavigate(
        this.automationState.sessionId,
        slideId,
        { source: 'automation-nav-controls' }
      );

      if (result.success) {
        this.logger?.info('AutomationNavigationControls: Navigation successful', { slideId });
        
        // Update local state (will be confirmed by state broadcast)
        this.automationState.currentSlide = slideId;
        this.currentSlideIndex = this.slideList.findIndex(s => s.id === slideId);
        this.updateUI();
      } else {
        this.logger?.warn('AutomationNavigationControls: Navigation failed', { slideId, result });
        this.showError('Navigation failed');
      }
    } catch (error) {
      this.logger?.error('AutomationNavigationControls: Navigation error', {
        slideId,
        error: error?.message || error
      });
      this.showError(`Navigation error: ${error?.message || error}`);
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const statusEl = this.find(`#${this.elementId}-status`);
    if (statusEl) {
      statusEl.classList.add('automation-nav__status--error');
      statusEl.textContent = message;
      
      setTimeout(() => {
        statusEl.classList.remove('automation-nav__status--error');
        this.updateStatus();
      }, 3000);
    }
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    if (this._unsubscribeAutomation) {
      this._unsubscribeAutomation();
    }

    if (this._keyboardHandler) {
      document.removeEventListener('keydown', this._keyboardHandler);
    }

    super.destroy();
  }
}

export default AutomationNavigationControls;
