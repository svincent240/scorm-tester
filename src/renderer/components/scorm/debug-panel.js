import { BaseComponent } from '../base-component.js';

export class DebugPanel extends BaseComponent {
    constructor(elementId, options = {}) {
        super(elementId, options);
        this.activeTab = 'api-calls'; // Default active tab
        this.views = new Map(); // To store instances of sub-views
        this.logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }; // Initialize with no-op logger

        import(`${window.electronAPI.rendererBaseUrl}utils/renderer-logger.js`).then(({ rendererLogger }) => {
            if (rendererLogger) {
                this.logger = rendererLogger;
            }
            this.logger.debug('DebugPanel: constructor called', elementId, options);
        }).catch(() => { /* no-op */ });

        // Dynamically import eventBus
        import(`${window.electronAPI.rendererBaseUrl}services/event-bus.js`).then(({ eventBus }) => {
            this.eventBus = eventBus;
        }).catch(error => {
            this.logger.error('DebugPanel: Failed to load eventBus', error);
        });
    }

    async setup() {
        this.logger.debug('DebugPanel: setup() called');
        // Render the basic panel structure with tabs
        this.renderContent();
        
        // Initialize sub-views
        await this.initializeViews();
        
        // Set up tab switching
        this.setupTabListeners();
        
        // Activate default tab
        this.activateTab(this.activeTab);
    }

    renderContent() {
        this.logger.debug('DebugPanel: renderContent() called');
        this.element.innerHTML = `
            <div class="debug-panel__container">
                ${!this.options.hideHeader ? `
                    <div class="debug-panel__header">
                        <h2 class="debug-panel__title">SCORM Debug Panel</h2>
                    </div>
                ` : ''}
                <div class="debug-panel__tabs">
                    <button class="debug-tab" data-tab="api-calls">API Calls</button>
                    <button class="debug-tab" data-tab="data-model">Data Model</button>
                    <button class="debug-tab" data-tab="session">Session</button>
                    <button class="debug-tab" data-tab="errors">Errors</button>
                    <button class="debug-tab" data-tab="diagnostics">Diagnostics</button>
                </div>
                <div class="debug-panel__content">
                    <div id="api-calls-view" class="debug-content" data-tab-content="api-calls"></div>
                    <div id="data-model-view" class="debug-content" data-tab-content="data-model"></div>
                    <div id="session-view" class="debug-content" data-tab-content="session"></div>
                    <div id="errors-view" class="debug-content" data-tab-content="errors"></div>
                    <div id="diagnostics-view" class="debug-content" data-tab-content="diagnostics"></div>
                </div>
            </div>
        `;
    }

    async initializeViews() {
        this.logger.debug('DebugPanel: initializeViews() called');
        // Initialize ApiTimelineView
        const apiCallsRoot = this.element.querySelector('#api-calls-view');
        if (apiCallsRoot) {
            const { ApiTimelineView } = await import('./debug-views/api-timeline-view.js');
            this.apiTimelineView = new ApiTimelineView('api-calls-view', []); // Pass elementId
            await this.apiTimelineView.initialize();
            this.views.set('api-calls', this.apiTimelineView);
            this.logger.debug('DebugPanel: ApiTimelineView initialized');
        } else {
            this.logger.error('DebugPanel: #api-calls-view root element not found.');
        }
        // Other views would be initialized here
    }

    setupTabListeners() {
        this.logger.debug('DebugPanel: setupTabListeners() called');
        const tabsContainer = this.element.querySelector('.debug-panel__tabs');
        if (tabsContainer) {
            tabsContainer.addEventListener('click', (event) => {
                const target = event.target;
                if (target.classList.contains('debug-tab')) {
                    const tabName = target.dataset.tab;
                    this.activateTab(tabName);
                }
            });
        }
    }

    activateTab(tabName) {
        this.logger.debug('DebugPanel: activateTab() called', tabName);
        // Deactivate current tab and content
        const currentActiveTabBtn = this.element.querySelector(`.debug-tab--active`);
        if (currentActiveTabBtn) {
            currentActiveTabBtn.classList.remove('debug-tab--active');
        }
        const currentActiveContent = this.element.querySelector(`.debug-content[data-tab-content="${this.activeTab}"]`);
        if (currentActiveContent) {
            currentActiveContent.style.display = 'none';
        }

        // Activate new tab and content
        const newActiveTabBtn = this.element.querySelector(`.debug-tab[data-tab="${tabName}"]`);
        if (newActiveTabBtn) {
            newActiveTabBtn.classList.add('debug-tab--active');
        }
        const newActiveContent = this.element.querySelector(`.debug-content[data-tab-content="${tabName}"]`);
        if (newActiveContent) {
            newActiveContent.style.display = 'flex'; // Use flex to maintain column layout
        }
        this.activeTab = tabName;
        
        // Refresh active view if it has a refresh method
        const activeView = this.views.get(this.activeTab);
        if (activeView && typeof activeView.refresh === 'function') {
            activeView.refresh();
        }
    }

    // Public methods for DebugWindow to call
    addApiCall(payload) {
        this.logger.debug('DebugPanel: addApiCall() called, delegating to ApiTimelineView');
        const apiTimelineView = this.views.get('api-calls');
        if (apiTimelineView && typeof apiTimelineView.addApiCall === 'function') {
            apiTimelineView.addApiCall(payload);
        } else {
            this.logger.warn('DebugPanel: ApiTimelineView not available to add API call.');
        }
    }

    handleCourseLoaded() {
        this.logger.debug('DebugPanel: handleCourseLoaded() called, delegating to views.');
        this.views.forEach(view => {
            if (typeof view.handleCourseLoaded === 'function') {
                view.handleCourseLoaded();
            }
        });
    }

    refreshSessionInfo() {
        this.logger.debug('DebugPanel: refreshSessionInfo() called, delegating to views.');
        this.views.forEach(view => {
            if (typeof view.refreshSessionInfo === 'function') {
                view.refreshSessionInfo();
            }
        });
    }

    refreshActiveTab() {
        this.logger.debug('DebugPanel: refreshActiveTab() called');
        const activeView = this.views.get(this.activeTab);
        if (activeView && typeof activeView.refresh === 'function') {
            activeView.refresh();
        }
    }

    destroy() {
        this.logger.debug('DebugPanel: destroy() called');
        // Destroy sub-views
        this.views.forEach(view => {
            if (typeof view.destroy === 'function') {
                view.destroy();
            }
        });
        this.views.clear();
        super.destroy(); // Call BaseComponent's destroy method
    }
}