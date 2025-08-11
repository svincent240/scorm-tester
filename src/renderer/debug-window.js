"use strict";

import { ApiTimelineView } from './components/scorm/debug-views/api-timeline-view.js';

document.addEventListener('DOMContentLoaded', () => {
    const apiTimelineContainer = document.getElementById('api-timeline-container');
    if (!apiTimelineContainer) {
        window.electronAPI.logger.error('API timeline container not found.');
        return;
    }

    const apiTimelineView = new ApiTimelineView('api-timeline-container');

    // Listen for SCORM API call events from the main process
    window.electronAPI.onScormApiCallLogged((data) => {
        apiTimelineView.addApiCall(data);
    });

    // Request initial history from main process if needed (optional, can be flushed by main)
    // ipcRenderer.send('debug-window-ready');
});