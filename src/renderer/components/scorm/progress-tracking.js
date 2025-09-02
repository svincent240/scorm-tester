/**
 * Progress Tracking Component
 * 
 * Displays real-time learning progress including completion status,
 * score, time tracking, and progress visualization.
 * 
 * @fileoverview SCORM progress tracking component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { scormClient } from '../../services/scorm-client.js';

/**
 * Progress Tracking Class
 */
class ProgressTracking extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.progressData = {
      completionStatus: 'not attempted',
      successStatus: 'unknown',
      scoreRaw: null,
      progressMeasure: 0,
      sessionTime: '00:00:00'
    };
    
    this.updateInterval = null;
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'progress-tracking',
      showScore: true,
      showTime: true,
      updateInterval: 1000,
      attributes: { 'data-component': 'progress-tracking' }
    };
  }

  /**
   * Override setLogger to ensure BaseComponent logger is available if needed
   */
  setLogger(logger) {
    super.setLogger(logger);
  }

  async setup() {
    this.uiState = await uiStatePromise; // Resolve the promise
    this.loadProgressData();
    this.startUpdateTimer();
  }

  renderContent() {
    this.element.innerHTML = `
      <div class="progress-tracking__container">
        <div class="progress-tracking__header">
          <h3>Learning Progress</h3>
        </div>
        
        <div class="progress-bar">
          <div class="progress-bar__track">
            <div class="progress-bar__fill" id="${this.elementId}-fill" style="width: 0%"></div>
          </div>
          <div class="progress-bar__label" id="${this.elementId}-percentage">0%</div>
        </div>
        
        <div class="progress-stats">
          <div class="progress-stat">
            <span class="stat-label">Status:</span>
            <span class="stat-value" id="${this.elementId}-status">Not Started</span>
          </div>
          
          ${this.options.showScore ? `
            <div class="progress-stat">
              <span class="stat-label">Score:</span>
              <span class="stat-value" id="${this.elementId}-score">--</span>
            </div>
          ` : ''}
          
          ${this.options.showTime ? `
            <div class="progress-stat">
              <span class="stat-label">Time:</span>
              <span class="stat-value" id="${this.elementId}-time">00:00:00</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Get element references
    this.progressFill = this.find('.progress-bar__fill');
    this.percentageLabel = this.find('.progress-bar__label');
    this.statusElement = this.find(`#${this.elementId}-status`);
    this.scoreElement = this.find(`#${this.elementId}-score`);
    this.timeElement = this.find(`#${this.elementId}-time`);
  }

  setupEventSubscriptions() {
    this.subscribe('progress:updated', this.handleProgressUpdated);
    this.subscribe('ui:scorm:dataChanged', this.handleScormDataChanged);
    this.subscribe('ui:scorm:initialized', this.handleScormInitialized);
    this.subscribe('course:loaded', this.handleCourseLoaded);
    this.subscribe('course:cleared', this.handleCourseCleared);
  }

  updateProgress(data) {
    this.progressData = { ...this.progressData, ...data };
    this.updateDisplay();
    this.emit('progressDisplayUpdated', this.progressData);
  }

  updateDisplay() {
    // Update progress bar
    const percentage = Math.round((this.progressData.progressMeasure || 0) * 100);
    if (this.progressFill) {
      this.progressFill.style.width = `${percentage}%`;
    }
    if (this.percentageLabel) {
      this.percentageLabel.textContent = `${percentage}%`;
    }

    // Update status
    if (this.statusElement) {
      this.statusElement.textContent = this.formatStatus(this.progressData.completionStatus);
    }

    // Update score
    if (this.scoreElement && this.options.showScore) {
      this.scoreElement.textContent = this.formatScore(this.progressData.scoreRaw);
    }

    // Update time
    if (this.timeElement && this.options.showTime) {
      this.timeElement.textContent = this.progressData.sessionTime || '00:00:00';
    }
    

    // Also update footer elements if they exist
    // This is now handled by dedicated footer components listening to uiState.
  }

  formatStatus(status) {
    const statusMap = {
      'completed': 'Completed',
      'incomplete': 'In Progress',
      'not attempted': 'Not Started',
      'unknown': 'Unknown'
    };
    return statusMap[status] || status;
  }

  formatScore(score) {
    return (score !== null && score !== undefined) ? `${score}` : '--';
  }

  loadProgressData() {
    const data = this.uiState.getState('progressData'); // Use the resolved instance
    if (data) {
      this.updateProgress(data);
    }
  }

  startUpdateTimer() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(() => {
      this.refreshFromScorm();
    }, this.options.updateInterval);
  }

  refreshFromScorm() {
    if (!scormClient.getInitialized()) return;
    
    try {
      const updates = {
        completionStatus: scormClient.getCachedValue('cmi.completion_status'),
        successStatus: scormClient.getCachedValue('cmi.success_status'),
        scoreRaw: parseFloat(scormClient.getCachedValue('cmi.score.raw')) || null,
        progressMeasure: parseFloat(scormClient.getCachedValue('cmi.progress_measure')) || 0
      };
      
      this.updateProgress(updates);
    } catch (error) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('ProgressTracking: Failed to refresh progress from SCORM', error?.message || error);
      }).catch(() => {});
    }
  }

  handleProgressUpdated(data) {
    this.updateProgress(data.data || data);
  }

  handleScormDataChanged(data) {
    const { element, value } = data.data || data;
    const updates = {};
    
    switch (element) {
      case 'cmi.completion_status':
        updates.completionStatus = value;
        break;
      case 'cmi.success_status':
        updates.successStatus = value;
        break;
      case 'cmi.score.raw':
        updates.scoreRaw = parseFloat(value) || null;
        break;
      case 'cmi.progress_measure':
        updates.progressMeasure = parseFloat(value) || 0;
        break;
    }
    
    if (Object.keys(updates).length > 0) {
      this.updateProgress(updates);
    }
  }

  handleScormInitialized() {
    this.refreshFromScorm();
  }

  handleCourseLoaded() {
    this.show();
  }

  handleCourseCleared() {
    this.updateProgress({
      completionStatus: 'not attempted',
      successStatus: 'unknown',
      scoreRaw: null,
      progressMeasure: 0,
      sessionTime: '00:00:00'
    });
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    super.destroy();
  }
}

export { ProgressTracking };
