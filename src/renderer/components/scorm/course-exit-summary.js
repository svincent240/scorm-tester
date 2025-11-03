// @ts-check

/**
 * Course Exit Summary Component
 * 
 * Modal dialog that displays when a course exits (complete or incomplete).
 * Shows final session data including completion status, success status, score,
 * time, objectives, and resume point. Includes "Test Resume" functionality
 * for incomplete exits.
 * 
 * @fileoverview Course exit summary modal component
 */

import { BaseComponent } from '../base-component.js';
import { escapeHTML } from '../../utils/escape.js';
import { rendererLogger } from '../../utils/renderer-logger.js';

export class CourseExitSummary extends BaseComponent {
  constructor(elementId = 'course-exit-summary') {
    super(elementId, {
      className: 'course-exit-summary',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'course-exit-summary-title'
      }
    });

    this.sessionData = null;
    this._dialogVisible = false;
  }

  /**
   * Show exit summary with session data
   * @param {Object} data - Session exit data
   */
  show(data) {
    this.sessionData = data;
    this._dialogVisible = true;

    // Store for debugging in e2e tests
    if (typeof window !== 'undefined') {
      window.__lastExitData = data;
    }

    this.render();

    // Set up event listeners after render
    this.setupEventListeners();
  }

  /**
   * Render component content
   */
  renderContent() {
    if (!this.element) return;

    if (!this._dialogVisible || !this.sessionData) {
      this.element.style.display = 'none';
      return;
    }

    this.element.style.display = 'flex';

    const data = this.sessionData;
    const isComplete = data.completionStatus === 'completed';
    const isPassed = data.successStatus === 'passed';
    const isFailed = data.successStatus === 'failed';
    const isSuspended = data.exitType === 'suspend';
    
    // Determine icon and title based on exit type
    let icon = '📊';
    let title = 'Course Session Summary';
    let statusClass = 'neutral';
    
    if (isComplete && isPassed) {
      icon = '✅';
      title = 'Course Completed Successfully';
      statusClass = 'success';
    } else if (isComplete && isFailed) {
      icon = '❌';
      title = 'Course Completed';
      statusClass = 'failed';
    } else if (isComplete) {
      icon = '✓';
      title = 'Course Completed';
      statusClass = 'complete';
    } else if (isSuspended) {
      icon = '⏸️';
      title = 'Course Suspended';
      statusClass = 'suspended';
    } else {
      icon = '🚪';
      title = 'Course Exited';
      statusClass = 'exited';
    }

    const safeTitle = escapeHTML(data.courseTitle || 'SCORM Course');
    const safeCompletionStatus = escapeHTML(data.completionStatus || 'unknown');
    const safeSuccessStatus = escapeHTML(data.successStatus || 'unknown');
    const safeLocation = escapeHTML(data.location || '');
    const safeSuspendData = escapeHTML(data.suspendData || '');
    
    // Format objectives
    const objectivesHtml = this.formatObjectives(data.objectives || []);
    
    // Format time
    const sessionTime = data.sessionTime || '00:00:00';
    const totalTime = data.totalTime || '00:00:00';

    this.element.innerHTML = `
      <div class="course-exit-summary__overlay"></div>
      <div class="course-exit-summary__content course-exit-summary__content--${statusClass}">
        <div class="course-exit-summary__header">
          <h2 id="course-exit-summary-title" class="course-exit-summary__title">
            <span class="course-exit-summary__icon">${icon}</span>
            ${escapeHTML(title)}
          </h2>
        </div>
        
        <div class="course-exit-summary__body">
          <div class="course-exit-summary__course-title">
            ${safeTitle}
          </div>
          
          <div class="course-exit-summary__section">
            <h3>Session Status</h3>
            <div class="course-exit-summary__grid">
              <div class="course-exit-summary__field">
                <label>Completion Status:</label>
                <span class="course-exit-summary__value course-exit-summary__value--${safeCompletionStatus}">
                  ${this.formatCompletionStatus(safeCompletionStatus)}
                </span>
              </div>
              <div class="course-exit-summary__field">
                <label>Success Status:</label>
                <span class="course-exit-summary__value course-exit-summary__value--${safeSuccessStatus}">
                  ${this.formatSuccessStatus(safeSuccessStatus)}
                </span>
              </div>
            </div>
          </div>

          ${data.scoreRaw !== null && data.scoreRaw !== undefined ? `
            <div class="course-exit-summary__section">
              <h3>Score</h3>
              <div class="course-exit-summary__grid">
                <div class="course-exit-summary__field">
                  <label>Raw Score:</label>
                  <span class="course-exit-summary__value">${escapeHTML(String(data.scoreRaw))}</span>
                </div>
                ${data.scoreScaled !== null && data.scoreScaled !== undefined ? `
                  <div class="course-exit-summary__field">
                    <label>Scaled Score:</label>
                    <span class="course-exit-summary__value">${escapeHTML(String(Math.round(data.scoreScaled * 100)))}%</span>
                  </div>
                ` : ''}
                ${data.scoreMin !== null && data.scoreMin !== undefined ? `
                  <div class="course-exit-summary__field">
                    <label>Min Score:</label>
                    <span class="course-exit-summary__value">${escapeHTML(String(data.scoreMin))}</span>
                  </div>
                ` : ''}
                ${data.scoreMax !== null && data.scoreMax !== undefined ? `
                  <div class="course-exit-summary__field">
                    <label>Max Score:</label>
                    <span class="course-exit-summary__value">${escapeHTML(String(data.scoreMax))}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}

          <div class="course-exit-summary__section">
            <h3>Time Tracking</h3>
            <div class="course-exit-summary__grid">
              <div class="course-exit-summary__field">
                <label>Session Time:</label>
                <span class="course-exit-summary__value">${escapeHTML(sessionTime)}</span>
              </div>
              <div class="course-exit-summary__field">
                <label>Total Time:</label>
                <span class="course-exit-summary__value">${escapeHTML(totalTime)}</span>
              </div>
            </div>
          </div>

          ${objectivesHtml ? `
            <div class="course-exit-summary__section">
              <h3>Objectives</h3>
              ${objectivesHtml}
            </div>
          ` : ''}

          ${!isComplete && (safeLocation || safeSuspendData) ? `
            <div class="course-exit-summary__section course-exit-summary__section--resume">
              <h3>Resume Information</h3>
              <p class="course-exit-summary__resume-note">
                This course can be resumed from where you left off.
              </p>
              ${safeLocation ? `
                <div class="course-exit-summary__field">
                  <label>Resume Location:</label>
                  <span class="course-exit-summary__value course-exit-summary__value--location">${safeLocation}</span>
                </div>
              ` : ''}
              ${safeSuspendData ? `
                <details class="course-exit-summary__suspend-data">
                  <summary>Suspend Data (${safeSuspendData.length} characters)</summary>
                  <pre class="course-exit-summary__code">${safeSuspendData.substring(0, 500)}${safeSuspendData.length > 500 ? '...' : ''}</pre>
                </details>
              ` : ''}
            </div>
          ` : ''}

          <div class="course-exit-summary__section course-exit-summary__section--confirmation">
            <p class="course-exit-summary__confirmation">
              ✓ All session data has been successfully saved to the LMS.
            </p>
          </div>
        </div>

        <div class="course-exit-summary__footer">
          ${!isComplete ? `
            <button class="course-exit-summary__button course-exit-summary__button--test-resume" data-action="test-resume">
              🔄 Test Resume
            </button>
          ` : ''}
          <button class="course-exit-summary__button course-exit-summary__button--close" data-action="close">
            Close
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Format completion status for display
   */
  formatCompletionStatus(status) {
    const statusMap = {
      'completed': 'Completed',
      'incomplete': 'Incomplete',
      'not attempted': 'Not Attempted',
      'unknown': 'Unknown'
    };
    return statusMap[status] || status;
  }

  /**
   * Format success status for display
   */
  formatSuccessStatus(status) {
    const statusMap = {
      'passed': 'Passed',
      'failed': 'Failed',
      'unknown': 'Unknown'
    };
    return statusMap[status] || status;
  }

  /**
   * Format objectives for display
   */
  formatObjectives(objectives) {
    if (!objectives || objectives.length === 0) {
      return '';
    }

    const objectiveItems = objectives.map(obj => {
      const safeId = escapeHTML(obj.id || '');
      const safeDescription = escapeHTML(obj.description || '');
      const successStatus = obj.successStatus || 'unknown';
      const completionStatus = obj.completionStatus || 'unknown';
      
      return `
        <div class="course-exit-summary__objective">
          <div class="course-exit-summary__objective-header">
            <strong>${safeId}</strong>
            ${safeDescription ? `<span class="course-exit-summary__objective-desc">${safeDescription}</span>` : ''}
          </div>
          <div class="course-exit-summary__objective-status">
            <span class="course-exit-summary__value course-exit-summary__value--${successStatus}">
              ${this.formatSuccessStatus(successStatus)}
            </span>
            <span class="course-exit-summary__value course-exit-summary__value--${completionStatus}">
              ${this.formatCompletionStatus(completionStatus)}
            </span>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="course-exit-summary__objectives-list">${objectiveItems}</div>`;
  }

  /**
   * Set up event listeners for buttons
   */
  setupEventListeners() {
    if (!this.element) return;

    const closeBtn = this.element.querySelector('[data-action="close"]');
    const testResumeBtn = this.element.querySelector('[data-action="test-resume"]');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    if (testResumeBtn) {
      testResumeBtn.addEventListener('click', () => this.handleTestResume());
    }
  }

  /**
   * Handle test resume button click
   */
  async handleTestResume() {
    try {
      const sessionId = this.sessionData?.sessionId;
      rendererLogger.info('CourseExitSummary: Test resume clicked', { sessionId, hasEventBus: !!this.eventBus });
      // Emit event to trigger resume test using eventBus directly
      // (not using this.emit() because it adds component namespace prefix)
      if (this.eventBus) {
        this.eventBus.emit('course:test-resume', {
          sessionId,
          sessionData: this.sessionData
        });
        rendererLogger.info('CourseExitSummary: Emitted course:test-resume', { sessionId });
      } else {
        rendererLogger.error('CourseExitSummary: eventBus missing; cannot emit course:test-resume', { sessionId });
      }

      // DO NOT close the dialog here - it triggers cleanup which deletes the RTE instance
      // The dialog will be closed automatically when the course loads
      // Just hide it for now
      this._dialogVisible = false;
      this.render();
    } catch (error) {
      rendererLogger.error('CourseExitSummary: Test resume failed', error);
    }
  }

  /**
   * Close the dialog
   */
  close() {
    const sessionId = this.sessionData?.sessionId;
    // Emit event to notify that exit summary is closed (for cleanup)
    // Use eventBus directly to avoid component namespace prefix
    if (sessionId && this.eventBus) {
      this.eventBus.emit('course:exit-summary-closed', { sessionId });
      rendererLogger.info('CourseExitSummary: Emitted course:exit-summary-closed', { sessionId });
    } else if (sessionId && !this.eventBus) {
      rendererLogger.error('CourseExitSummary: eventBus missing; cannot emit course:exit-summary-closed', { sessionId });
    }

    this._dialogVisible = false;
    this.sessionData = null;
    this.render();
  }
}

