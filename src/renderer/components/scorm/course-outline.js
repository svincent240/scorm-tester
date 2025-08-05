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
    this.loadCourseStructure();
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
    this.subscribe('course:loaded', (data) => {
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
      rendererLogger.debug('CourseOutline: event progress:updated', data);
      this.handleProgressUpdated(data);
    });
    this.subscribe('scorm:dataChanged', (data) => {
      rendererLogger.debug('CourseOutline: event scorm:dataChanged', data);
      this.handleScormDataChanged(data);
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
    
    rendererLogger.info('CourseOutline: Course structure rendered successfully', { itemCount: items.length });
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

  loadCourseStructure() {
    const structure = this.uiState.getState('courseStructure'); // Use the resolved instance
    rendererLogger.info('CourseOutline.loadCourseStructure: state check', {
      hasStructure: !!structure,
      hasItems: !!structure?.items,
      itemCount: structure?.items?.length || 0
    });
    if (structure) {
      this.setCourseStructure(structure);
    } else {
      this.showEmptyState();
    }
  }

  setCourseStructure(structure) {
    this.courseStructure = structure;
    this.expandedItems.clear();
    this.progressData.clear();
    this.currentItem = null;
    rendererLogger.info('CourseOutline.setCourseStructure: structure set', {
      hasItems: !!structure?.items,
      itemCount: structure?.items?.length || 0
    });
    this.renderCourseStructure();
  }

  handleCourseLoaded(data) {
    const courseData = data.data || data;
    rendererLogger.info('CourseOutline.handleCourseLoaded: received', {
      hasStructure: !!courseData?.structure,
      hasItems: !!courseData?.structure?.items,
      itemCount: courseData?.structure?.items?.length || 0
    });
    if (courseData.structure) {
      this.setCourseStructure(courseData.structure);
    } else if (courseData.manifest) {
      const converted = this.convertManifestToStructure(courseData.manifest);
      rendererLogger.info('CourseOutline.handleCourseLoaded: converted manifest to structure', { itemCount: converted?.items?.length || 0 });
      if (converted) this.setCourseStructure(converted);
    } else {
      rendererLogger.warn('CourseOutline.handleCourseLoaded: no structure or manifest found in payload');
      this.showEmptyState();
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
    }
  }

  handleScormDataChanged(data) {
    const { element, value } = data.data || data;
    
    if (element === 'cmi.completion_status' && this.currentItem) {
      this.updateItemProgress(this.currentItem, { completionStatus: value });
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
      
      // Extract structure from courseData
      let structure = null;
      
      if (courseData?.structure) {
        structure = courseData.structure;
      } else if (courseData?.manifest && courseData.manifest.organizations) {
        // Convert manifest to structure format
        structure = this.convertManifestToStructure(courseData.manifest);
      }
      
      if (structure) {
        this.setCourseStructure(structure);
        try { rendererLogger.info('CourseOutline: Course structure updated successfully'); } catch (_) {}
        // Explicit re-render to avoid lifecycle races
        this.renderCourseStructure();
      } else {
        try { rendererLogger.warn('CourseOutline: No valid structure found in course data'); } catch (_) {}
        this.showEmptyState();
      }
      
    } catch (error) {
      try { rendererLogger.error('CourseOutline: Error updating with course data:', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Convert manifest data to course structure format
   * @param {Object} manifest - SCORM manifest data
   * @returns {Object} Course structure
   */
  convertManifestToStructure(manifest) {
    if (!manifest.organizations || !manifest.organizations.organization) {
      return null;
    }
    
    const org = Array.isArray(manifest.organizations.organization)
      ? manifest.organizations.organization[0]
      : manifest.organizations.organization;
    
    return {
      title: org.title || 'Course',
      identifier: org.identifier || 'course',
      items: this.convertManifestItems(org.item || [])
    };
  }

  /**
   * Convert manifest items to structure items
   * @param {Array|Object} items - Manifest items
   * @returns {Array} Structure items
   */
  convertManifestItems(items) {
    const itemArray = Array.isArray(items) ? items : [items];
    
    return itemArray.map(item => ({
      identifier: item.identifier || item.identifierref || 'unknown',
      title: item.title || item.identifier || 'Untitled',
      type: item.identifierref ? 'sco' : 'asset',
      children: item.item ? this.convertManifestItems(item.item) : []
    }));
  }

  destroy() {
    this.expandedItems.clear();
    this.progressData.clear();
    super.destroy();
  }
}

export { CourseOutline };