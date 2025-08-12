import { BaseComponent } from '../../base-component.js';
// Dynamically import eventBus and rendererLogger within the constructor

export class ApiTimelineView extends BaseComponent {
    constructor(elementId, initialApiCalls = []) {
        super(elementId);
        this.apiCalls = [...initialApiCalls];
        this.logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }; // Initialize with no-op logger

        import(`${window.electronAPI.rendererBaseUrl}utils/renderer-logger.js`).then(({ rendererLogger }) => {
            if (rendererLogger) {
                this.logger = rendererLogger;
            }
            this.logger.debug('ApiTimelineView: constructor called with elementId and initial calls', elementId, initialApiCalls.length);
        }).catch(() => { /* no-op */ });

        // Dynamically import eventBus
        import(`${window.electronAPI.rendererBaseUrl}services/event-bus.js`).then(({ eventBus }) => {
            this.eventBus = eventBus;
        }).catch(error => {
            this.logger.error('ApiTimelineView: Failed to load eventBus', error);
        });
    }

    renderContent() {
        this.logger.debug('ApiTimelineView: renderContent() called');
        this.element.innerHTML = `
            <div class="api-timeline-view">
                <h3>API Call Timeline</h3>
                <ul id="api-calls-list"></ul>
            </div>
        `;
    }

    refresh() {
        this.logger.debug('ApiTimelineView: refresh() called. Current calls:', this.apiCalls.length);
        const apiCallsList = this.element.querySelector('#api-calls-list');

        if (!apiCallsList) {
            this.logger.warn('ApiTimelineView: #api-calls-list not found for refresh.');
            return;
        }

        if (!apiCallsList) {
            this.logger.warn('ApiTimelineView: #api-calls-list not found for refresh.');
            return;
        }

        if (this.apiCalls.length === 0) {
            apiCallsList.innerHTML = '<div class="debug-log__empty">No API calls recorded</div>';
            return;
        }

        const html = this.apiCalls.map(call => this.formatApiCall(call)).join('');
        apiCallsList.innerHTML = html;
    }

    addApiCall(call) {
        this.logger.debug('ApiTimelineView: addApiCall() called', call);
        this.apiCalls.push(call);
        // Optionally, trim history if it gets too large in the renderer
        // For now, rely on main process to manage history size
        this.refresh(); // Re-render to show the new call
    }

    handleCourseLoaded() {
        this.logger.debug('ApiTimelineView: Handling course loaded event, clearing timeline.');
        this.apiCalls = []; // Clear internal data
        this.clear(); // Clear the rendered view
    }

    refreshSessionInfo() {
        this.logger.debug('ApiTimelineView: Refreshing session info, clearing timeline.');
        this.apiCalls = []; // Clear internal data
        this.clear(); // Clear the rendered view
    }
 
    clear() {
        this.logger.debug('ApiTimelineView: Clearing timeline');
        const apiCallsList = this.element.querySelector('#api-calls-list');
        if (apiCallsList) {
            apiCallsList.innerHTML = '<div class="debug-log__empty">No API calls recorded</div>';
        }
    }

}