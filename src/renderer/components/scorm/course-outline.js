/**
 * Course Outline Component
 * 
 * Displays hierarchical course structure with navigation,
 * progress indicators, and expandable tree view.
 * 
 * @fileoverview SCORM course outline component
 */

import { BaseComponent } from '../base-component.js';
import { uiState } from '../../services/ui-state.js';

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
    this.loadCourseStructure();
  }

  renderContent() {
    this.element.innerHTML = `
      <div class="course-outline__container">
        <div class="course-outline__header">
          <h3>Course Structure</h3>
          <div class="course-outline__controls">
            <button class="outline-btn" id="${this.elementId}-expand-all" title="Expand All">⊞</button>
            <button class="outline-btn" id="${this.elementId}-collapse-all" title="Collapse All">⊟</button>
          </div>
        </div>
        
        <div class="course-outline__content" id="${this.elementId}-content">
          <div class="course-outline__empty">
            <div class="empty-icon">📚</div>
            <div class="empty-title">No Course Loaded</div>
            <div class="empty-message">Load a SCORM package to view course structure</div>
          </div>
        </div>
      </div>
    `;

    this.contentArea = this.find(`#${this.elementId}-content`);
    this.expandAllBtn = this.find(`#${this.elementId}-expand-all`);
    this.collapseAllBtn = this.find(`#${this.elementId}-collapse-all`);
  }

  setupEventSubscriptions() {
    this.subscribe('course:loaded', this.handleCourseLoaded);
    this.subscribe('course:cleared', this.handleCourseCleared);
    this.subscribe('navigation:updated', this.handleNavigationUpdated);
    this.subscribe('progress:updated', this.handleProgressUpdated);
    this.subscribe('scorm:dataChanged', this.handleScormDataChanged);
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
    if (!this.courseStructure || !this.contentArea) {
      this.showEmptyState();
      return;
    }
    
    const html = this.renderItems(this.courseStructure.items || []);
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
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = this.expandedItems.has(item.identifier);
    const isCurrent = this.currentItem === item.identifier;
    const progress = this.progressData.get(item.identifier) || {};
    
    const itemClass = [
      'outline-item',
      hasChildren ? 'outline-item--parent' : 'outline-item--leaf',
      isCurrent ? 'outline-item--current' : '',
      isExpanded ? 'outline-item--expanded' : ''
    ].filter(Boolean).join(' ');
    
    return `
      <li class="${itemClass}" data-item-id="${item.identifier}">
        <div class="outline-item__content">
          ${hasChildren ? `
            <button class="outline-item__toggle" data-item-id="${item.identifier}">
              ${isExpanded ? '▼' : '▶'}
            </button>
          ` : '<span class="outline-item__spacer"></span>'}
          
          ${this.options.showIcons ? `
            <span class="outline-item__icon">${this.getItemIcon(item, progress)}</span>
          ` : ''}
          
          <span class="outline-item__title" data-item-id="${item.identifier}">
            ${item.title || item.identifier}
          </span>
          
          ${this.options.showProgress ? `
            <span class="outline-item__progress">${this.getProgressIndicator(progress)}</span>
          ` : ''}
        </div>
        
        ${hasChildren && isExpanded ? this.renderItems(item.children, depth + 1) : ''}
      </li>
    `;
  }

  getItemIcon(item, progress) {
    if (item.type === 'sco') {
      switch (progress.completionStatus) {
        case 'completed': return '✅';
        case 'incomplete': return '🔄';
        case 'not attempted': return '⭕';
        default: return '📄';
      }
    }
    return item.type === 'asset' ? '📎' : '📁';
  }

  getProgressIndicator(progress) {
    if (!progress.completionStatus) return '';
    
    const statusMap = {
      'completed': '<span class="progress-indicator progress-indicator--completed">✓</span>',
      'incomplete': '<span class="progress-indicator progress-indicator--incomplete">○</span>',
      'not attempted': '<span class="progress-indicator progress-indicator--not-attempted">○</span>'
    };
    
    return statusMap[progress.completionStatus] || '';
  }

  bindItemEvents() {
    this.findAll('.outline-item__toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleItem(e.target.dataset.itemId);
      });
    });
    
    if (this.options.enableNavigation) {
      this.findAll('.outline-item__title').forEach(title => {
        title.addEventListener('click', (e) => {
          this.navigateToItem(e.target.dataset.itemId);
        });
      });
    }
  }

  toggleItem(itemId) {
    if (this.expandedItems.has(itemId)) {
      this.expandedItems.delete(itemId);
    } else {
      this.expandedItems.add(itemId);
    }
    
    this.renderCourseStructure();
    this.emit('itemToggled', { itemId, expanded: this.expandedItems.has(itemId) });
  }

  navigateToItem(itemId) {
    if (!this.options.enableNavigation) return;
    
    this.setCurrentItem(itemId);
    this.emit('navigationRequested', { itemId });
  }

  setCurrentItem(itemId) {
    this.currentItem = itemId;
    
    this.findAll('.outline-item').forEach(el => {
      el.classList.toggle('outline-item--current', el.dataset.itemId === itemId);
    });
    
    this.emit('currentItemChanged', { itemId });
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
      if (item.children && item.children.length > 0) {
        this.expandedItems.add(item.identifier);
        this.addAllItemIds(item.children);
      }
    });
  }

  updateItemProgress(itemId, progress) {
    this.progressData.set(itemId, progress);
    this.renderCourseStructure();
  }

  showEmptyState() {
    if (this.contentArea) {
      this.contentArea.innerHTML = `
        <div class="course-outline__empty">
          <div class="empty-icon">📚</div>
          <div class="empty-title">No Course Loaded</div>
          <div class="empty-message">Load a SCORM package to view course structure</div>
        </div>
      `;
    }
  }

  loadCourseStructure() {
    const structure = uiState.getState('courseStructure');
    if (structure) {
      this.setCourseStructure(structure);
    }
  }

  setCourseStructure(structure) {
    this.courseStructure = structure;
    this.expandedItems.clear();
    this.progressData.clear();
    this.currentItem = null;
    this.renderCourseStructure();
  }

  handleCourseLoaded(data) {
    const courseData = data.data || data;
    if (courseData.structure) {
      this.setCourseStructure(courseData.structure);
    }
  }

  handleCourseCleared() {
    this.courseStructure = null;
    this.expandedItems.clear();
    this.progressData.clear();
    this.currentItem = null;
    this.showEmptyState();
  }

  handleNavigationUpdated(data) {
    const navData = data.data || data;
    if (navData.currentItem && navData.currentItem !== this.currentItem) {
      this.setCurrentItem(navData.currentItem);
    }
  }

  handleProgressUpdated(data) {
    const progressData = data.data || data;
    if (this.currentItem && progressData) {
      this.updateItemProgress(this.currentItem, progressData);
    }
  }

  handleScormDataChanged(data) {
    const { element, value } = data.data || data;
    
    if (element === 'cmi.completion_status' && this.currentItem) {
      this.updateItemProgress(this.currentItem, { completionStatus: value });
    }
  }

  destroy() {
    this.expandedItems.clear();
    this.progressData.clear();
    super.destroy();
  }
}

export { CourseOutline };