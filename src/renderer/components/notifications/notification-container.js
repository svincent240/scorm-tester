// @ts-check

/**
 * Notification Container Component
 * 
 * Renders toast notifications from UIState in a fixed position on screen.
 * Subscribes to UIState notifications array and renders each notification
 * with appropriate styling and dismiss functionality.
 * 
 * @fileoverview Notification container component
 */

import { BaseComponent } from '../base-component.js';
import { escapeHTML } from '../../utils/escape.js';

export class NotificationContainer extends BaseComponent {
  constructor(elementId = 'notification-container') {
    super(elementId, {
      className: 'notifications-container notifications-container--top-right',
      attributes: {
        role: 'region',
        'aria-label': 'Notifications',
        'aria-live': 'polite'
      }
    });

    this.notifications = [];
  }

  /**
   * Initialize component
   */
  async initialize() {
    await super.initialize();

    // Subscribe to notifications from UIState
    const unsubscribe = this.uiState.subscribe((notifications) => {
      this.notifications = notifications || [];
      this.render();
    }, 'ui.notifications');

    this.unsubscribeFunctions.push(unsubscribe);
  }

  /**
   * Render component content
   */
  renderContent() {
    if (!this.element) return;

    // Clear existing content
    this.element.innerHTML = '';

    // Render each notification
    this.notifications.forEach(notification => {
      const notificationEl = this.createNotificationElement(notification);
      this.element.appendChild(notificationEl);
    });
  }

  /**
   * Create a notification DOM element
   * @param {Object} notification - Notification data
   * @returns {HTMLElement} Notification element
   */
  createNotificationElement(notification) {
    const div = document.createElement('div');
    div.className = `notification notification--${notification.type || 'info'}`;
    div.setAttribute('role', 'alert');
    div.setAttribute('data-notification-id', String(notification.id));

    const icon = this.getIconForType(notification.type);
    const safeMessage = escapeHTML(notification.message || '');
    const safeTitle = notification.title ? escapeHTML(notification.title) : '';
    const safeDetails = notification.details ? escapeHTML(notification.details) : '';

    let content = `
      <div class="notification__icon">${icon}</div>
      <div class="notification__content">
        ${safeTitle ? `<div class="notification__title">${safeTitle}</div>` : ''}
        <div class="notification__message">${safeMessage}</div>
        ${safeDetails ? `<div class="notification__details">${safeDetails}</div>` : ''}
      </div>
    `;

    // Add action buttons if provided
    if (notification.actions && Array.isArray(notification.actions)) {
      const actionsHtml = notification.actions.map((action, index) => {
        const safeLabel = escapeHTML(action.label || 'Action');
        return `<button class="notification__action" data-action-index="${index}">${safeLabel}</button>`;
      }).join('');
      
      content += `<div class="notification__actions">${actionsHtml}</div>`;
    }

    // Add dismiss button
    content += `<button class="notification__close" aria-label="Dismiss notification">×</button>`;

    div.innerHTML = content;

    // Bind event handlers
    this.bindNotificationEvents(div, notification);

    return div;
  }

  /**
   * Bind event handlers to notification element
   * @param {HTMLElement} element - Notification element
   * @param {Object} notification - Notification data
   */
  bindNotificationEvents(element, notification) {
    // Close button
    const closeBtn = element.querySelector('.notification__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.dismissNotification(notification.id, element);
      });
    }

    // Action buttons
    const actionButtons = element.querySelectorAll('.notification__action');
    actionButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const action = notification.actions[index];
        if (action && typeof action.handler === 'function') {
          try {
            action.handler();
          } catch (error) {
            this.logger?.error('NotificationContainer: Action handler error', error?.message || error);
          }
        }
        // Dismiss notification after action
        this.dismissNotification(notification.id, element);
      });
    });
  }

  /**
   * Dismiss a notification with animation
   * @param {string|number} notificationId - Notification ID
   * @param {HTMLElement} element - Notification element
   */
  dismissNotification(notificationId, element) {
    // Add dismissing class for animation
    element.classList.add('notification--dismissing');

    // Wait for animation to complete
    setTimeout(() => {
      // Remove from UIState
      if (this.uiState) {
        this.uiState.removeNotification(notificationId);
      }
    }, 200); // Match animation duration in CSS
  }

  /**
   * Get icon for notification type
   * @param {string} type - Notification type
   * @returns {string} Icon HTML
   */
  getIconForType(type) {
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    return icons[type] || icons.info;
  }

  /**
   * Cleanup component
   */
  destroy() {
    // Clear all notifications
    this.notifications = [];
    super.destroy();
  }
}

