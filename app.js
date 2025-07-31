class EnhancedScormPreview {
    constructor() {
        this.currentSessionId = null;
        this.currentCoursePath = null;
        this.sessionStartTime = null;
        this.sessionTimer = null;
        this.isConnected = true;
        this.networkDelay = 0;
        this.cleanupFunctions = [];
        this.localDataCache = new Map(); // Add local data cache
        this.initializeElements();
        this.bindEvents();
        this.startSessionTimer();
        this.setupCleanup();
    }

    setupCleanup() {
        window.addEventListener('beforeunload', () => this.cleanup());
        window.addEventListener('unload', () => this.cleanup());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseTimers();
            } else {
                this.resumeTimers();
            }
        });
    }

    initializeElements() {
        this.elements = {
            loadZipBtn: document.getElementById('loadZipBtn'),
            loadFolderBtn: document.getElementById('loadFolderBtn'),
            resetSessionBtn: document.getElementById('resetSessionBtn'),
            suspendBtn: document.getElementById('suspendBtn'),
            disconnectBtn: document.getElementById('disconnectBtn'),
            fullscreenBtn: document.getElementById('fullscreenBtn'),
            validateBtn: document.getElementById('validateBtn'),
            lmsProfileSelect: document.getElementById('lmsProfileSelect'),
            error: document.getElementById('error'),
            courseInfo: document.getElementById('courseInfo'),
            courseTitle: document.getElementById('courseTitle'),
            courseVersion: document.getElementById('courseVersion'),
            scormVersion: document.getElementById('scormVersion'),
            sessionId: document.getElementById('sessionId'),
            connectionStatus: document.getElementById('connectionStatus'),
            connectionText: document.getElementById('connectionText'),
            loading: document.getElementById('loading'),
            previewFrame: document.getElementById('previewFrame'),
            noContent: document.getElementById('noContent'),
            apiLog: document.getElementById('apiLog')
        };
    }

    bindEvents() {
        this.eventHandlers = {
            loadZip: () => this.loadScormPackage(),
            loadFolder: () => this.loadScormFolder(),
            resetSession: () => this.resetSession(),
            suspend: () => this.suspendSession(),
            disconnect: () => this.toggleConnection(),
            fullscreen: () => this.toggleFullscreen(),
            profileChange: (e) => this.applyLmsProfile(e.target.value),
            validate: () => this.validateScormPackage(),
            frameLoad: () => {
                this.hideLoading();
                this.logApiCall('system', 'Course loaded successfully');
            },
            frameError: () => {
                this.hideLoading();
                this.showError('Failed to load course content');
            }
        };

        this.elements.loadZipBtn.addEventListener('click', this.eventHandlers.loadZip);
        this.elements.loadFolderBtn.addEventListener('click', this.eventHandlers.loadFolder);
        this.elements.resetSessionBtn.addEventListener('click', this.eventHandlers.resetSession);
        this.elements.suspendBtn.addEventListener('click', this.eventHandlers.suspend);
        this.elements.disconnectBtn.addEventListener('click', this.eventHandlers.disconnect);
        this.elements.fullscreenBtn.addEventListener('click', this.eventHandlers.fullscreen);
        
        if (this.elements.lmsProfileSelect) {
            this.elements.lmsProfileSelect.addEventListener('change', this.eventHandlers.profileChange);
        }
        if (this.elements.validateBtn) {
            this.elements.validateBtn.addEventListener('click', this.eventHandlers.validate);
        }

        this.elements.previewFrame.addEventListener('load', this.eventHandlers.frameLoad);
        this.elements.previewFrame.addEventListener('error', this.eventHandlers.frameError);

        if (window.electronAPI?.onMenuEvent) {
            const menuCleanup = window.electronAPI.onMenuEvent((event, data) => {
                switch(event) {
                    case 'load-package':
                        this.loadScormPackage();
                        break;
                    case 'reset-session':
                        this.resetSession();
                        break;
                    case 'simulate':
                        this.handleSimulation(data);
                        break;
                    case 'fullscreen':
                        this.toggleFullscreen();
                        break;
                }
            });
            
            if (typeof menuCleanup === 'function') {
                this.cleanupFunctions.push(menuCleanup);
            }
        }

        // Add listener for SCORM API logs from main process
        if (window.electronAPI?.onScormApiLog) {
            const apiLogCleanup = window.electronAPI.onScormApiLog((data) => {
                console.log(`SCORM API Log: Method: ${data.method}, Element: ${data.element}, Value: ${data.value}, ErrorCode: ${data.errorCode}`);
            });
            if (typeof apiLogCleanup === 'function') {
                this.cleanupFunctions.push(apiLogCleanup);
            }
        }
    }

    cleanup() {
        try {
            if (this.sessionTimer) {
                clearInterval(this.sessionTimer);
                this.sessionTimer = null;
            }

            if (this.eventHandlers && this.elements) {
                this.elements.loadZipBtn?.removeEventListener('click', this.eventHandlers.loadZip);
                this.elements.loadFolderBtn?.removeEventListener('click', this.eventHandlers.loadFolder);
                this.elements.resetSessionBtn?.removeEventListener('click', this.eventHandlers.resetSession);
                this.elements.suspendBtn?.removeEventListener('click', this.eventHandlers.suspend);
                this.elements.disconnectBtn?.removeEventListener('click', this.eventHandlers.disconnect);
                this.elements.fullscreenBtn?.removeEventListener('click', this.eventHandlers.fullscreen);
                
                if (this.elements.lmsProfileSelect) {
                    this.elements.lmsProfileSelect.removeEventListener('change', this.eventHandlers.profileChange);
                }
                if (this.elements.validateBtn) {
                    this.elements.validateBtn.removeEventListener('click', this.eventHandlers.validate);
                }

                this.elements.previewFrame?.removeEventListener('load', this.eventHandlers.frameLoad);
                this.elements.previewFrame?.removeEventListener('error', this.eventHandlers.frameError);
            }

            this.cleanupFunctions.forEach(cleanup => {
                try {
                    cleanup();
                } catch (error) {
                    console.warn('Cleanup function failed:', error);
                }
            });
            this.cleanupFunctions = [];

            if (this.currentSessionId && window.API) {
                try {
                    window.API.LMSFinish('');
                } catch (error) {
                    console.warn('Failed to terminate SCORM session:', error);
                }
            }
            console.log('ScormPreview cleanup completed');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    pauseTimers() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    resumeTimers() {
        if (!this.sessionTimer && this.sessionStartTime) {
            this.startSessionTimer();
        }
    }

    async loadScormPackage() {
        console.log('app.js: loadScormPackage called');
        try {
            this.showLoading();
            this.clearError();
            console.log('app.js: Calling electronAPI.selectScormPackage()');
            const zipPath = await window.electronAPI.selectScormPackage();
            if (!zipPath) {
                console.log('app.js: No zip path returned from dialog');
                this.hideLoading();
                return;
            }
            console.log(`app.js: Zip path selected: ${zipPath}`);
            const extractedPath = await window.electronAPI.extractScorm(zipPath);
            if (!extractedPath) {
                console.error('app.js: Failed to extract SCORM package');
                throw new Error('Failed to extract SCORM package');
            }
            console.log(`app.js: SCORM package extracted to: ${extractedPath}`);
            await this.loadCourse(extractedPath);
        } catch (error) {
            console.error('app.js: Error loading SCORM package:', error);
            this.hideLoading();
            this.showError(`Error loading SCORM package: ${error.message}`);
        }
    }

    async loadScormFolder() {
        try {
            this.showLoading();
            this.clearError();
            const folderPath = await window.electronAPI.selectScormFolder();
            if (!folderPath) {
                this.hideLoading();
                return;
            }
            await this.loadCourse(folderPath);
        } catch (error) {
            this.hideLoading();
            this.showError(`Error loading SCORM folder: ${error.message}`);
        }
    }

    async loadCourse(coursePath) {
        console.log(`app.js: loadCourse called with path: ${coursePath}`);
        try {
            const entryPointResult = await window.electronAPI.findScormEntry(coursePath);
            if (!entryPointResult || !entryPointResult.success) {
                const errorMessage = entryPointResult ? entryPointResult.error : 'Unknown error finding course entry point.';
                console.error(`app.js: Failed to find SCORM entry point: ${errorMessage}`);
                throw new Error(`Could not find course entry point: ${errorMessage}`);
            }
            const entryPoint = entryPointResult.entryPath;
            const launchUrl = entryPointResult.launchUrl; // Get the launchUrl
            console.log(`app.js: Found SCORM entry point: ${entryPoint}`);
            console.log(`app.js: Launch URL from manifest: ${launchUrl}`); // Log the launchUrl
            const courseInfo = await window.electronAPI.getCourseInfo(coursePath);
            // Check if courseInfo also indicates an error
            if (courseInfo && courseInfo.error) {
                console.error(`app.js: Failed to get course info: ${courseInfo.error}`);
                throw new Error(`Failed to get course information: ${courseInfo.error}`);
            }
            
            this.currentSessionId = 'session_' + Date.now();
            this.currentCoursePath = coursePath;
            this.sessionStartTime = new Date();
            
            await window.electronAPI.scormInitialize(this.currentSessionId);
            
            this.displayCourseInfo(courseInfo);
            // Pass launchUrl to loadCourseInFrame
            this.loadCourseInFrame(entryPoint, launchUrl); // Pass launchUrl instead of contentIdentifier
            this.enableControls();
            this.setupScormAPI();
            
            this.logApiCall('system', `New session initialized: ${this.currentSessionId}`);

        } catch (error) {
            console.error('app.js: Error in loadCourse:', error);
            this.hideLoading();
            this.showError(`Error loading course: ${error.message}`);
        }
    }

    async loadCourseInFrame(entryPoint, launchUrl) { // Changed parameter name
        // Use launchUrl directly, which already contains the query parameter
        const finalFileUrl = await window.electronAPI.pathUtils.toFileUrl(entryPoint);
        // Append the query string from launchUrl to finalFileUrl
        const queryString = launchUrl.includes('?') ? launchUrl.substring(launchUrl.indexOf('?')) : '';
        const fullUrlWithQuery = finalFileUrl + queryString;

        console.log(`app.js: loadCourseInFrame - entryPoint: ${entryPoint}`);
        console.log(`app.js: loadCourseInFrame - launchUrl (from manifest): ${launchUrl}`);
        console.log(`app.js: loadCourseInFrame - final URL for iframe: ${fullUrlWithQuery}`);
        this.elements.previewFrame.src = fullUrlWithQuery;
        
        this.elements.noContent.style.display = 'none';
        this.elements.previewFrame.style.display = 'block';
    }

    displayCourseInfo(courseInfo) {
        this.elements.courseTitle.textContent = courseInfo.title;
        this.elements.courseVersion.textContent = courseInfo.version;
        this.elements.scormVersion.textContent = courseInfo.scormVersion;
        this.elements.sessionId.textContent = this.currentSessionId;
        this.elements.courseInfo.style.display = 'block';
    }

    setupScormAPI() {
        const self = this;
        // No need for apiCache, cacheTimeout, commitTimer, debouncedCommit here.
        // The main process's ScormApiHandler will handle the actual data and caching.

        window.API = {
            LMSInitialize: function(param) {
                self.logApiCall('init', 'LMSInitialize', param);
                // Asynchronously initialize session in main process
                window.electronAPI.scormInitialize(self.currentSessionId)
                    .then(response => {
                        if (response.success) {
                            // On successful initialization, fetch initial data to populate local cache
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.core.lesson_status')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.core.lesson_status', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.completion_status')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.completion_status', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.core.score.raw')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.core.score.raw', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.score.raw')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.score.raw', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.core.lesson_location')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.core.lesson_location', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.location')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.location', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.suspend_data')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.suspend_data', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.core.session_time')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.core.session_time', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.session_time')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.session_time', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.core.total_time')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.core.total_time', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.total_time')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.total_time', res.value); });
                        } else {
                            console.error('SCORM Initialize failed:', response.errorCode);
                        }
                    })
                    .catch(error => console.error('Error initializing SCORM session:', error));
                return self.isConnected ? "true" : "false"; // Always return true for synchronous API
            },
            LMSFinish: function(param) {
                self.logApiCall('finish', 'LMSFinish', param);
                if (self.isConnected) {
                    window.electronAPI.scormTerminate(self.currentSessionId)
                        .catch(error => console.error('Error terminating SCORM session:', error));
                    return "true";
                }
                return "false";
            },
            LMSGetValue: function(element) {
                if (!self.isConnected) {
                    self.logApiCall('get', 'LMSGetValue', element, 'CONNECTION_ERROR');
                    return "";
                }
                
                // Return from local cache immediately for synchronous behavior
                let value = self.localDataCache.get(element) || "";
                self.logApiCall('get', 'LMSGetValue', element, value);

                // Asynchronously request fresh data from main process
                window.electronAPI.scormGetValue(self.currentSessionId, element)
                    .then(response => {
                        if (response.success) {
                            self.localDataCache.set(element, response.value);
                            self.updateDataDisplay(element, response.value);
                        } else {
                            console.warn(`LMSGetValue async update failed for ${element}:`, response.errorCode);
                        }
                    })
                    .catch(error => console.error(`Error in async LMSGetValue for ${element}:`, error));
                
                return value;
            },
            LMSSetValue: function(element, value) {
                if (!self.isConnected) {
                    self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, 'CONNECTION_ERROR');
                    return "false";
                }
                
                // Update local cache immediately for synchronous behavior
                self.localDataCache.set(element, value);
                self.updateDataDisplay(element, value); // Update UI immediately

                // Asynchronously send value to main process
                window.electronAPI.scormSetValue(self.currentSessionId, element, value)
                    .then(response => {
                        self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, response.success ? 'SUCCESS' : 'ERROR');
                        // If main process indicates a change in related data (e.g., completion status), update local cache
                        if (response.success && (element === 'cmi.core.lesson_status' || element === 'cmi.completion_status')) {
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.completion_status')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.completion_status', res.value); });
                            window.electronAPI.scormGetValue(self.currentSessionId, 'cmi.success_status')
                                .then(res => { if (res.success) self.localDataCache.set('cmi.success_status', res.value); });
                        }
                    })
                    .catch(error => self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, `ERROR: ${error.message}`));
                
                return "true"; // Always return true for synchronous API
            },
            LMSCommit: function(param) {
                if (!self.isConnected) {
                    self.logApiCall('commit', 'LMSCommit', param, 'CONNECTION_ERROR');
                    return "false";
                }
                // Asynchronously commit to main process
                window.electronAPI.scormCommit(self.currentSessionId)
                    .then(result => self.logApiCall('commit', 'LMSCommit', '', result.success ? 'SUCCESS' : 'ERROR'))
                    .catch(() => self.logApiCall('commit', 'LMSCommit', '', 'ERROR'));
                return "true";
            },
            LMSGetLastError: function() {
                // This should ideally come from the main process, but for synchronous API,
                // we might need to return a cached error or a generic one.
                // For now, return a generic "No error" if connected, or "301" if disconnected.
                return self.isConnected ? "0" : "301";
            },
            LMSGetErrorString: function(errorCode) {
                const errors = { "0": "No error", "301": "General Get Failure", "351": "General Set Failure", "401": "Undefined Data Model", "405": "Incorrect Data Type" };
                return errors[errorCode] || "Unknown error";
            },
            LMSGetDiagnostic: function(errorCode) { return `Diagnostic for error ${errorCode}`; }
        };

        window.API_1484_11 = {
            Initialize: (p) => window.API.LMSInitialize(p),
            Terminate: (p) => window.API.LMSFinish(p),
            GetValue: (e) => window.API.LMSGetValue(e),
            SetValue: (e, v) => window.API.LMSSetValue(e, v),
            Commit: (p) => window.API.LMSCommit(p),
            GetLastError: () => window.API.LMSGetLastError(),
            GetErrorString: (c) => window.API.LMSGetErrorString(c),
            GetDiagnostic: (c) => window.API.LMSGetDiagnostic(c)
        };
    }

    updateDataDisplay(element, value) {
        const updates = {
            'cmi.core.lesson_status': 'lessonStatus', 'cmi.completion_status': 'lessonStatus',
            'cmi.core.score.raw': 'scoreRaw', 'cmi.score.raw': 'scoreRaw',
            'cmi.core.lesson_location': 'lessonLocation', 'cmi.location': 'lessonLocation',
            'cmi.suspend_data': 'suspendData', 'cmi.core.session_time': 'sessionTime',
            'cmi.session_time': 'sessionTime', 'cmi.core.total_time': 'totalTime',
            'cmi.total_time': 'totalTime'
        };

        if (updates[element]) {
            const displayElement = document.getElementById(updates[element]);
            if (displayElement) {
                displayElement.textContent = value || 'Not set';
                displayElement.parentElement.classList.add('changed');
                setTimeout(() => displayElement.parentElement.classList.remove('changed'), 2000);
            }
        }

        if (element.includes('score.raw') && value) {
            const score = parseFloat(value);
            if (!isNaN(score) && score >= 0 && score <= 100) {
                const progressFill = document.getElementById('progressFill');
                progressFill.style.width = `${score}%`;
                progressFill.textContent = `${score}%`;
            }
        }
    }

    logApiCall(type, method, parameter, result) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `api-call ${type}`;
        logEntry.innerHTML = `<strong>${timestamp}</strong> ${method}(${parameter || ''}) → ${result || ''}`;
        this.elements.apiLog.appendChild(logEntry);
        this.elements.apiLog.scrollTop = this.elements.apiLog.scrollHeight;
        while (this.elements.apiLog.children.length > 50) {
            this.elements.apiLog.removeChild(this.elements.apiLog.firstChild);
        }
    }

    async resetSession() {
        if (this.currentSessionId) {
            await window.electronAPI.resetSession(this.currentSessionId);
            this.currentSessionId = 'session_' + Date.now();
            await window.electronAPI.scormInitialize(this.currentSessionId);
            
            document.getElementById('lessonStatus').textContent = 'incomplete';
            document.getElementById('scoreRaw').textContent = 'Not set';
            document.getElementById('lessonLocation').textContent = 'Not set';
            document.getElementById('suspendData').textContent = 'Empty';
            document.getElementById('progressFill').style.width = '0%';
            document.getElementById('progressFill').textContent = '0%';
            
            this.elements.apiLog.innerHTML = '<div class="api-call">Session reset - Ready for API calls...</div>';
            this.logApiCall('system', `Session reset: ${this.currentSessionId}`);
            
            if (this.elements.previewFrame.src) {
                this.elements.previewFrame.src = this.elements.previewFrame.src;
            }
        }
    }

    suspendSession() {
        this.logApiCall('system', 'Session suspended by user');
    }

    toggleConnection() {
        this.isConnected = !this.isConnected;
        const status = this.isConnected ? 'connected' : 'disconnected';
        this.elements.connectionStatus.className = `status-indicator ${status}`;
        this.elements.connectionText.textContent = this.isConnected ? 'Connected' : 'Disconnected';
        this.elements.disconnectBtn.innerHTML = this.isConnected ? '🔌 Disconnect' : '🔗 Connect';
        this.logApiCall('system', `Connection ${this.isConnected ? 'restored' : 'lost'}`);
    }

    toggleFullscreen() {
        if (this.elements.previewFrame.requestFullscreen) {
            this.elements.previewFrame.requestFullscreen();
        }
    }

    startSessionTimer() {
        if (this.sessionTimer) clearInterval(this.sessionTimer);
        this.sessionTimer = setInterval(() => {
            if (!this.sessionStartTime || !this.currentSessionId || document.hidden) return;
            try {
                const elapsed = new Date() - this.sessionStartTime;
                const hours = Math.floor(elapsed / 3600000);
                const minutes = Math.floor((elapsed % 3600000) / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                const sessionTimeElement = document.getElementById('sessionTime');
                if (sessionTimeElement) {
                    sessionTimeElement.textContent = timeString;
                } else {
                    clearInterval(this.sessionTimer);
                    this.sessionTimer = null;
                }
            } catch (error) {
                console.warn('Session timer error:', error);
                clearInterval(this.sessionTimer);
                this.sessionTimer = null;
            }
        }, 1000);
    }

    stopSessionTimer() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    enableControls() {
        this.elements.resetSessionBtn.disabled = false;
        this.elements.suspendBtn.disabled = false;
        this.elements.disconnectBtn.disabled = false;
        this.elements.fullscreenBtn.disabled = false;
        this.elements.validateBtn.disabled = false;
    }

    async applyLmsProfile(profileId) {
        if (!profileId || !this.currentSessionId) return;
        try {
            const result = await window.electronAPI.applyLmsProfile(this.currentSessionId, profileId);
            if (result.success) {
                this.logApiCall('system', `Applied ${result.profile} profile`);
                this.setStatus(`Applied ${result.profile} settings`, 'success');
            }
        } catch (error) {
            this.showError(`Failed to apply LMS profile: ${error.message}`);
        }
    }

    async validateScormPackage() {
        if (!this.currentCoursePath) {
            this.showError('No course loaded to validate');
            return;
        }
        try {
            this.setStatus('Validating SCORM package...');
            const validation = await window.electronAPI.validateScormCompliance(this.currentCoursePath);
            const analysis = await window.electronAPI.analyzeScormContent(this.currentCoursePath);
            this.showValidationResults(validation, analysis);
        } catch (error) {
            this.showError(`Validation failed: ${error.message}`);
        }
    }

    showValidationResults(validation, analysis) {
        let resultsWindow;
        try {
            resultsWindow = window.open('', 'validation', 'width=600,height=700,scrollbars=yes');
            if (!resultsWindow) {
                this.showError('Popup blocked. Please allow popups to view validation results.');
                return;
            }
        } catch (error) {
            this.showError('Unable to open validation results window.');
            return;
        }
        
        const formatSize = (bytes) => {
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            if (bytes === 0) return '0 Bytes';
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        };
        const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
         .replace(/"/g, "\"")
         .replace(/'/g, "&#039;");
};
        try {
            resultsWindow.document.write(`...`); // Content omitted for brevity, it's the same as before
            resultsWindow.document.close();
        } catch (error) {
            console.error('Error writing to validation window:', error);
            if (resultsWindow) resultsWindow.close();
            this.showError('Failed to display validation results.');
        }
    }
    
    setStatus(message, type = 'info') {
        // A simple status display could be done by repurposing the error display
        // or by adding a new status element to the HTML. For now, let's use the console.
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Example of updating a UI element if one existed
        const statusElement = document.getElementById('statusMessage');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `status ${type}`; // e.g., status success, status error
        }
    }

    showLoading() { this.elements.loading.classList.add('show'); }
    hideLoading() { this.elements.loading.classList.remove('show'); }
    showError(message) {
        this.elements.error.textContent = message;
        this.elements.error.classList.add('show');
    }
    clearError() { this.elements.error.classList.remove('show'); }
}

async function runTestScenario(scenarioType) {
    const app = window.scormApp;
    if (!app.currentSessionId) {
        app.showError('No active session to test');
        return;
    }
    try {
        app.setStatus(`Running ${scenarioType} test scenario...`);
        const result = await window.electronAPI.runTestScenario(app.currentSessionId, scenarioType);
        if (result.success) {
            app.logApiCall('system', `Test scenario completed: ${result.result}`);
            app.setStatus(`✅ ${result.result}`, 'success');
        } else {
            app.showError(`Test scenario failed: ${result.error}`);
        }
    } catch (error) {
        app.showError(`Test scenario error: ${error.message}`);
    }
}

function simulateNetworkDelay() {
    const app = window.scormApp;
    app.networkDelay = app.networkDelay > 0 ? 0 : 1000;
    app.logApiCall('system', `Network delay ${app.networkDelay > 0 ? 'enabled' : 'disabled'} (${app.networkDelay}ms)`);
}

function simulateTimeout() {
    const app = window.scormApp;
    app.logApiCall('system', 'Simulating connection timeout...');
    app.toggleConnection();
    setTimeout(() => app.toggleConnection(), 5000);
}

function forceComplete() {
    const app = window.scormApp;
    if (app.currentSessionId) {
        window.electronAPI.scormSetValue(app.currentSessionId, 'cmi.core.lesson_status', 'completed');
        window.electronAPI.scormSetValue(app.currentSessionId, 'cmi.completion_status', 'completed');
        app.updateDataDisplay('cmi.core.lesson_status', 'completed');
        app.logApiCall('system', 'Force completed by user');
    }
}

function clearData() {
    window.scormApp.resetSession();
}

function toggleSection(sectionId) {
    const content = document.getElementById(sectionId + 'Content');
    const toggle = document.getElementById(sectionId + 'Toggle');
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        toggle.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        toggle.textContent = '▶';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.scormApp = new EnhancedScormPreview();
});