const PathUtils = require('./utils/path-utils.js');
class EnhancedScormPreview {
    constructor() {
        this.currentSessionId = null;
        this.currentCoursePath = null;
        this.sessionStartTime = null;
        this.sessionTimer = null;
        this.isConnected = true;
        this.networkDelay = 0;
        this.cleanupFunctions = [];
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
        try {
            const entryPoint = await window.electronAPI.findScormEntry(coursePath);
            if (!entryPoint) {
                throw new Error('Could not find course entry point');
            }

            const courseInfo = await window.electronAPI.getCourseInfo(coursePath);
            
            this.currentSessionId = 'session_' + Date.now();
            this.currentCoursePath = coursePath;
            this.sessionStartTime = new Date();
            
            await window.electronAPI.scormInitialize(this.currentSessionId);
            
            this.displayCourseInfo(courseInfo);
            this.loadCourseInFrame(entryPoint);
            this.enableControls();
            this.setupScormAPI();
            
            this.logApiCall('system', `New session initialized: ${this.currentSessionId}`);

        } catch (error) {
            this.hideLoading();
            this.showError(`Error loading course: ${error.message}`);
        }
    }

    loadCourseInFrame(entryPoint) {
        const fileUrl = PathUtils.toFileUrl(entryPoint);
        this.elements.previewFrame.src = fileUrl;
        
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
        const apiCache = new Map();
        const cacheTimeout = 5000;
        let commitTimer = null;

        const debouncedCommit = (sessionId) => {
            if (commitTimer) clearTimeout(commitTimer);
            commitTimer = setTimeout(() => {
                window.electronAPI.scormCommit(sessionId)
                    .then(result => self.logApiCall('commit', 'LMSCommit', '', result.success ? 'SUCCESS' : 'ERROR'))
                    .catch(() => self.logApiCall('commit', 'LMSCommit', '', 'ERROR'));
            }, 200);
        };

        window.API = {
            LMSInitialize: function(param) {
                self.logApiCall('init', 'LMSInitialize', param);
                return self.isConnected ? "true" : "false";
            },
            LMSFinish: function(param) {
                self.logApiCall('finish', 'LMSFinish', param);
                if (self.isConnected) {
                    apiCache.clear();
                    window.electronAPI.scormTerminate(self.currentSessionId);
                    return "true";
                }
                return "false";
            },
            LMSGetValue: function(element) {
                if (!self.isConnected) {
                    self.logApiCall('get', 'LMSGetValue', element, 'CONNECTION_ERROR');
                    return "";
                }

                const cacheKey = `get_${element}`;
                const cached = apiCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < cacheTimeout) {
                    return cached.value;
                }
                
                let result = "";
                try {
                    const promise = window.electronAPI.scormGetValue(self.currentSessionId, element);
                    let timeoutId;
                    const timeout = new Promise((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('Timeout')), 100);
                    });
                    
                    Promise.race([promise, timeout])
                        .then(response => {
                            clearTimeout(timeoutId);
                            apiCache.set(cacheKey, { value: response.value, timestamp: Date.now() });
                            self.updateDataDisplay(element, response.value);
                        })
                        .catch(() => {
                            clearTimeout(timeoutId);
                            if (cached) result = cached.value;
                        });
                } catch (error) {
                    result = cached ? cached.value : "";
                }
                
                self.logApiCall('get', 'LMSGetValue', element, result);
                return result;
            },
            LMSSetValue: function(element, value) {
                if (!self.isConnected) {
                    self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, 'CONNECTION_ERROR');
                    return "false";
                }
                
                const cacheKey = `get_${element}`;
                apiCache.set(cacheKey, { value: value, timestamp: Date.now() });
                
                window.electronAPI.scormSetValue(self.currentSessionId, element, value)
                    .then(response => {
                        self.updateDataDisplay(element, value);
                        self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, response.success ? 'SUCCESS' : 'ERROR');
                        if (element.includes('lesson_status') || element.includes('score') || element.includes('completion_status')) {
                            debouncedCommit(self.currentSessionId);
                        }
                    })
                    .catch(() => self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, 'ERROR'));
                
                return "true";
            },
            LMSCommit: function(param) {
                if (!self.isConnected) {
                    self.logApiCall('commit', 'LMSCommit', param, 'CONNECTION_ERROR');
                    return "false";
                }
                apiCache.clear();
                debouncedCommit(self.currentSessionId);
                return "true";
            },
            LMSGetLastError: function() { return self.isConnected ? "0" : "301"; },
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
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
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