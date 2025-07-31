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
            apiLog: document.getElementById('apiLog'),
            courseNavigationTree: document.getElementById('courseNavigationTree'),
            courseNavigationPanel: document.getElementById('courseNavigationPanel'),
            mainCourseNavigationTree: document.getElementById('mainCourseNavigationTree'),
            navPanelInfo: document.getElementById('navPanelInfo')
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
                window.electronAPI.log('info', `SCORM API Log: Method: ${data.method}, Element: ${data.element}, Value: ${data.value}, ErrorCode: ${data.errorCode}`);
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
                    window.electronAPI.log('warn', 'Cleanup function failed:', error);
                }
            });
            this.cleanupFunctions = [];

            if (this.currentSessionId && window.API) {
                try {
                    window.API.LMSFinish('');
                } catch (error) {
                    window.electronAPI.log('warn', 'Failed to terminate SCORM session:', error);
                }
            }
            window.electronAPI.log('info', 'ScormPreview cleanup completed');
        } catch (error) {
            window.electronAPI.log('error', 'Error during cleanup:', error);
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
        window.electronAPI.log('info', 'app.js: loadScormPackage called');
        try {
            this.showLoading();
            this.clearError();
            window.electronAPI.log('info', 'app.js: Calling electronAPI.selectScormPackage()');
            const zipPath = await window.electronAPI.selectScormPackage();
            if (!zipPath) {
                window.electronAPI.log('info', 'app.js: No zip path returned from dialog');
                this.hideLoading();
                return;
            }
            window.electronAPI.log('info', `app.js: Zip path selected: ${zipPath}`);
            const extractedPath = await window.electronAPI.extractScorm(zipPath);
            if (!extractedPath) {
                window.electronAPI.log('error', 'app.js: Failed to extract SCORM package');
                throw new Error('Failed to extract SCORM package');
            }
            window.electronAPI.log('info', `app.js: SCORM package extracted to: ${extractedPath}`);
            await this.loadCourse(extractedPath);
        } catch (error) {
            window.electronAPI.log('error', 'app.js: Error loading SCORM package:', error);
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
        window.electronAPI.log('info', `app.js: loadCourse called with path: ${coursePath}`);
        try {
            const entryPointResult = await window.electronAPI.findScormEntry(coursePath);
            if (!entryPointResult || !entryPointResult.success) {
                const errorMessage = entryPointResult ? entryPointResult.error : 'Unknown error finding course entry point.';
                window.electronAPI.log('error', `app.js: Failed to find SCORM entry point: ${errorMessage}`);
                throw new Error(`Could not find course entry point: ${errorMessage}`);
            }
            const entryPoint = entryPointResult.entryPath;
            const launchUrl = entryPointResult.launchUrl; // Get the launchUrl
            window.electronAPI.log('info', `app.js: Found SCORM entry point: ${entryPoint}`);
            window.electronAPI.log('info', `app.js: Launch URL from manifest: ${launchUrl}`); // Log the launchUrl
            const courseInfo = await window.electronAPI.getCourseInfo(coursePath);
            // Check if courseInfo also indicates an error
            if (courseInfo && courseInfo.error) {
                window.electronAPI.log('error', `app.js: Failed to get course info: ${courseInfo.error}`);
                throw new Error(`Failed to get course information: ${courseInfo.error}`);
            }
            
            this.currentSessionId = 'session_' + Date.now();
            this.currentCoursePath = coursePath;
            this.currentCourseInfo = courseInfo; // NAVIGATION FIX: Store course info for flow-only detection
            this.sessionStartTime = new Date();
            
            await window.electronAPI.scormInitialize(this.currentSessionId);
            
            this.displayCourseInfo(courseInfo);
            // Pass launchUrl to loadCourseInFrame
            this.loadCourseInFrame(entryPoint, launchUrl); // Pass launchUrl instead of contentIdentifier
            
            // Get detailed course structure from the manifest
            const manifestData = await window.electronAPI.getCourseManifest(this.currentCoursePath);
            window.electronAPI.log('debug', 'app.js: manifestData received in loadCourse:', manifestData); // Added log
            window.electronAPI.log('debug', 'app.js: courseInfo received in loadCourse:', courseInfo); // Added log

            const courseStructure = (manifestData && manifestData.structure && manifestData.structure.items && manifestData.structure.items.length > 0) ? manifestData.structure.items : [];
            
            this.displayCourseNavigation(courseInfo); // Pass courseInfo directly
            this.enableControls();
            this.setupScormAPI();
            this.updateNavigationStatus(); // Update LMS navigation bar
            this.populateCourseOutline(courseInfo.courseStructure, courseInfo); // Pass courseStructure and courseInfo
            this.showCourseOutlineByDefault(); // Show outline by default like real LMS
            
            // Wait for course to fully load before enabling navigation
            setTimeout(() => {
                this.waitForCourseReady();
            }, 2000);
            
            this.logApiCall('system', `New session initialized: ${this.currentSessionId}`);

        } catch (error) {
            window.electronAPI.log('error', 'app.js: Error in loadCourse:', error);
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

        window.electronAPI.log('info', `app.js: loadCourseInFrame - entryPoint: ${entryPoint}`);
        window.electronAPI.log('info', `app.js: loadCourseInFrame - launchUrl (from manifest): ${launchUrl}`);
        window.electronAPI.log('info', `app.js: loadCourseInFrame - final URL for iframe: ${fullUrlWithQuery}`);
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

    async displayCourseNavigation(courseInfo) { // Modified signature
        try {
            const structure = courseInfo.courseStructure; // Get structure from courseInfo
            if (structure && structure.items && structure.items.length > 0) {
                window.electronAPI.log('info', 'displayCourseNavigation: Building main navigation with detailed structure:', structure);
                this.buildMainNavigation(structure, courseInfo);
                this.buildDebugNavigation(structure);
            } else {
                window.electronAPI.log('info', 'displayCourseNavigation: Building simple main navigation (flow-only or no items):', structure);
                // Fallback for courses without detailed structure or flow-only courses
                this.buildSimpleMainNavigation(courseInfo);
                this.buildSimpleDebugNavigation(courseInfo);
            }
            
            // Hide the main navigation panel by default (only show in dev mode)
            this.elements.courseNavigationPanel.style.display = 'none';
        } catch (error) {
            window.electronAPI.log('warn', 'Failed to get course navigation structure:', error);
            this.buildSimpleMainNavigation(courseInfo);
            this.buildSimpleDebugNavigation(courseInfo);
            this.elements.courseNavigationPanel.style.display = 'none';
        }
    }

    buildMainNavigation(structure, courseInfo) {
        const isFlowOnly = structure.isFlowOnly;
        
        if (structure.items && structure.items.length > 0) {
            // Course with visible structure
            this.elements.navPanelInfo.textContent = `${structure.items.length} sections available`;
            const nav = document.createElement('div');
            nav.className = 'main-course-nav';
            
            structure.items.forEach((item, index) => {
                const navItem = this.createMainNavItem(item, index === 0);
                nav.appendChild(navItem);
            });
            
            this.elements.mainCourseNavigationTree.innerHTML = '';
            this.elements.mainCourseNavigationTree.appendChild(nav);
        } else {
            // Fallback for courses without detailed structure or flow-only courses
            this.elements.navPanelInfo.textContent = 'Sequential navigation course';
            this.elements.mainCourseNavigationTree.innerHTML = `
                <div class="flow-navigation-info">
                    <div class="flow-icon">🧭</div>
                    <h5>Sequential Navigation Course</h5>
                    <p>This course includes Previous/Next navigation controls.</p>
                    <p><strong>Note:</strong> In a full LMS, you would see additional navigation UI (top bar, sidebar) that our tester doesn't provide.</p>
                    <p>The course content will load with basic navigation controls.</p>
                </div>
            `;
        }
    }

    buildSimpleMainNavigation(courseInfo) {
        this.elements.navPanelInfo.textContent = 'Course navigation';
        const isScorm2004 = courseInfo.scormVersion && courseInfo.scormVersion.includes('2004');
        this.elements.mainCourseNavigationTree.innerHTML = `
            <div class="flow-navigation-info">
                <div class="flow-icon">${isScorm2004 ? '🎯' : '📖'}</div>
                <h5>${this.escapeHtml(courseInfo.title || 'Course Content')}</h5>
                <p>${isScorm2004 ? 'SCORM 2004 course with sequential navigation.' : 'SCORM 1.2 course.'}</p>
                <p>Course content will include navigation controls.</p>
                <p><strong>Note:</strong> This course does not provide a detailed navigation structure in its manifest, or it is a flow-only course.</p>
            </div>
        `;
    }

    buildDebugNavigation(structure) {
        const tree = document.createElement('div');
        tree.className = 'course-nav-tree';
        
        if (structure.items && structure.items.length > 0) {
            structure.items.forEach((item, index) => {
                const navItem = this.createDebugNavItem(item, index === 0);
                tree.appendChild(navItem);
            });
        } else {
            tree.innerHTML = '<div class="nav-info">Flow-only navigation (choice="false")</div>';
        }
        
        this.elements.courseNavigationTree.innerHTML = '';
        this.elements.courseNavigationTree.appendChild(tree);
    }

    buildSimpleDebugNavigation(courseInfo) {
        const tree = document.createElement('div');
        tree.className = 'course-nav-tree';
        
        // Create debug information
        if (courseInfo.scormVersion && courseInfo.scormVersion.includes('2004')) {
            tree.innerHTML = `
                <div class="nav-item root">
                    <div class="nav-item-title current">📚 ${courseInfo.title}</div>
                    <div class="nav-info">SCORM 2004 - Sequential Navigation</div>
                    <div class="nav-info">Manifest: imsmanifest.xml</div>
                    <div class="nav-info">Mode: Flow-only (choice="false")</div>
                </div>
            `;
        } else {
            tree.innerHTML = `
                <div class="nav-item root">
                    <div class="nav-item-title current">📚 ${courseInfo.title}</div>
                    <div class="nav-info">SCORM 1.2 Course</div>
                    <div class="nav-info">Manifest: imsmanifest.xml</div>
                </div>
            `;
        }
        
        this.elements.courseNavigationTree.innerHTML = '';
        this.elements.courseNavigationTree.appendChild(tree);
    }

    createMainNavItem(item, isCurrent = false) {
        const navItem = document.createElement('div');
        navItem.className = `main-nav-item ${isCurrent ? 'current' : ''}`;
        
        const content = document.createElement('div');
        content.className = 'nav-item-content';
        
        const icon = document.createElement('span');
        icon.className = 'nav-item-icon';
        icon.textContent = item.identifierref ? '📚' : '📁';
        
        const title = document.createElement('span');
        title.textContent = item.title || item.identifier || 'Untitled';
        
        content.appendChild(icon);
        content.appendChild(title);
        navItem.appendChild(content);
        
        if (isCurrent) {
            const status = document.createElement('span');
            status.className = 'nav-item-status current';
            status.textContent = 'Current';
            navItem.appendChild(status);
        }
        
        // Add click handler for navigable items
        if (item.identifierref) {
            navItem.style.cursor = 'pointer';
            navItem.addEventListener('click', () => {
                // Future: implement navigation to specific item
                window.electronAPI.log('info', 'Navigate to:', item.identifier);
            });
        }
        
        return navItem;
    }

    createDebugNavItem(item, isCurrent = false) {
        const navItem = document.createElement('div');
        navItem.className = 'nav-item';
        
        const title = document.createElement('div');
        title.className = `nav-item-title ${isCurrent ? 'current' : ''}`;
        // Show visibility status and type in debug view
        const visibilityIcon = item.isVisible === false ? '👁️‍🗨️' : '👁️';
        const typeIcon = item.identifierref ? '📄' : '📁';
        title.textContent = `${visibilityIcon}${typeIcon} ${item.title || item.identifier || 'Untitled'}`;
        
        const info = document.createElement('div');
        info.className = 'nav-info';
        info.textContent = `ID: ${item.identifier}${item.identifierref ? ` → ${item.identifierref}` : ''} ${item.isVisible === false ? '(invisible)' : ''}`;
        
        navItem.appendChild(title);
        navItem.appendChild(info);
        
        // Add child items if they exist
        if (item.children && item.children.length > 0) {
            item.children.forEach(child => {
                const childItem = this.createDebugNavItem(child);
                navItem.appendChild(childItem);
            });
        }
        
        return navItem;
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
                            window.electronAPI.log('error', 'SCORM Initialize failed:', response.errorCode);
                        }
                    })
                    .catch(error => window.electronAPI.log('error', 'Error initializing SCORM session:', error));
                return self.isConnected ? "true" : "false"; // Always return true for synchronous API
            },
            LMSFinish: function(param) {
                self.logApiCall('finish', 'LMSFinish', param);
                if (self.isConnected) {
                    window.electronAPI.scormTerminate(self.currentSessionId)
                        .catch(error => window.electronAPI.log('error', 'Error terminating SCORM session:', error));
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
                            window.electronAPI.log('warn', `LMSGetValue async update failed for ${element}:`, response.errorCode);
                        }
                    })
                    .catch(error => window.electronAPI.log('error', `Error in async LMSGetValue for ${element}:`, error));
                
                return value;
            },
            LMSSetValue: function(element, value) {
                // Validate parameters
                if (typeof element !== 'string' || element === '') {
                    self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, 'INVALID_ELEMENT');
                    return "false";
                }
                
                if (value === null || value === undefined) {
                    self.logApiCall('set', 'LMSSetValue', `${element} = ${value}`, 'INVALID_VALUE');
                    return "false";
                }
                
                // Convert value to string if it isn't already
                value = String(value);
                
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

    // LMS Navigation functionality
    navigatePrevious() {
        const frame = this.elements.previewFrame;
        if (!frame || !frame.contentWindow) {
            console.log('No course loaded for navigation');
            window.electronAPI?.log('warn', 'NAVIGATION FIX: No course loaded for Previous navigation');
            return;
        }

        const isFlowOnly = this.isFlowOnlyCourse();
        window.electronAPI?.log('info', `NAVIGATION FIX: Previous navigation requested - Flow-only: ${isFlowOnly}`);

        try {
            // SCORM COMPLIANCE FIX: For flow-only courses, let the course handle navigation
            if (isFlowOnly) {
                window.electronAPI?.log('info', 'NAVIGATION FIX: Flow-only course - delegating to course content navigation');
                // Try to find and click the course's own previous button
                const success = this.tryNavigationMethods(frame, 'previous');
                if (!success) {
                    window.electronAPI?.log('info', 'NAVIGATION FIX: No course navigation found - trying keyboard fallback');
                    this.sendKeyboardNavigation(frame, 'ArrowLeft');
                }
            } else {
                // For choice navigation courses, LMS can control navigation
                window.electronAPI?.log('info', 'NAVIGATION FIX: Choice navigation course - LMS can control navigation');
                const success = this.tryNavigationMethods(frame, 'previous');
                if (!success) {
                    console.log('Previous navigation not available in this course');
                    this.sendKeyboardNavigation(frame, 'ArrowLeft');
                }
            }
        } catch (error) {
            console.log('Navigation error:', error.message);
            window.electronAPI?.log('error', `NAVIGATION FIX: Previous navigation error: ${error.message}`);
        }
    }

    navigateNext() {
        const frame = this.elements.previewFrame;
        if (!frame || !frame.contentWindow) {
            console.log('No course loaded for navigation');
            window.electronAPI?.log('warn', 'NAVIGATION FIX: No course loaded for Next navigation');
            return;
        }

        const isFlowOnly = this.isFlowOnlyCourse();
        window.electronAPI?.log('info', `NAVIGATION FIX: Next navigation requested - Flow-only: ${isFlowOnly}`);

        try {
            // SCORM COMPLIANCE FIX: For flow-only courses, let the course handle navigation
            if (isFlowOnly) {
                window.electronAPI?.log('info', 'NAVIGATION FIX: Flow-only course - delegating to course content navigation');
                // Try to find and click the course's own next button
                const success = this.tryNavigationMethods(frame, 'next');
                if (!success) {
                    window.electronAPI?.log('info', 'NAVIGATION FIX: No course navigation found - trying keyboard fallback');
                    this.sendKeyboardNavigation(frame, 'ArrowRight');
                }
            } else {
                // For choice navigation courses, LMS can control navigation
                window.electronAPI?.log('info', 'NAVIGATION FIX: Choice navigation course - LMS can control navigation');
                const success = this.tryNavigationMethods(frame, 'next');
                if (!success) {
                    console.log('Next navigation not available in this course');
                    this.sendKeyboardNavigation(frame, 'ArrowRight');
                }
            }
        } catch (error) {
            console.log('Navigation error:', error.message);
            window.electronAPI?.log('error', `NAVIGATION FIX: Next navigation error: ${error.message}`);
        }
    }

    tryNavigationMethods(frame, direction) {
        const contentWindow = frame.contentWindow;
        const contentDocument = frame.contentDocument;
        
        // NAVIGATION FIX: For flow-only courses, prioritize course content navigation
        const isFlowOnly = this.isFlowOnlyCourse();
        
        if (isFlowOnly) {
            window.electronAPI.log('info', `NAVIGATION FIX: Flow-only course - trying course content navigation first`);
            
            // Method 1: Try generic button selectors FIRST for flow-only courses
            const buttonSelectors = direction === 'next' ? [
                'input[type="button"][value*="next" i]', 'button[title*="next" i]', 'button[aria-label*="next" i]',
                'button[id*="next" i]', 'button[class*="next" i]', '.next-btn', '.btn-next', '.continue', '.forward',
                'button[title*="continue" i]', 'button[aria-label*="continue" i]',
                'a[title*="next" i]', '.nav-next', '[data-action="next"]', '[data-nav="next"]', '#nextBtn', '#next-button'
            ] : [
                'input[type="button"][value*="previous" i]', 'button[title*="previous" i]', 'button[aria-label*="previous" i]',
                'button[id*="prev" i]', 'button[class*="prev" i]', '.prev-btn', '.btn-prev', '.previous', '.back',
                'button[title*="back" i]', 'button[aria-label*="back" i]',
                'a[title*="previous" i]', '.nav-prev', '[data-action="previous"]', '[data-nav="previous"]', '#prevBtn', '#prev-button'
            ];

            for (const selector of buttonSelectors) {
                try {
                    const button = contentDocument?.querySelector(selector);
                    if (button && !button.disabled && button.offsetParent !== null) {
                        button.click();
                        console.log(`NAVIGATION FIX: Flow-only course navigation - ${direction} via ${selector}`);
                        window.electronAPI.log('info', `NAVIGATION FIX: Successfully clicked course button: ${selector}`);
                        return true;
                    }
                } catch (e) {
                    // Continue to next selector
                }
            }
            
            // Method 2: Try Storyline navigation for flow-only
            if (this.tryStorylineNavigation(contentWindow, direction)) {
                console.log(`NAVIGATION FIX: Flow-only Storyline navigation - ${direction}`);
                return true;
            }

            // Method 3: Try Captivate navigation for flow-only
            if (this.tryCaptivateNavigation(contentWindow, direction)) {
                console.log(`NAVIGATION FIX: Flow-only Captivate navigation - ${direction}`);
                return true;
            }
            
            // DO NOT try SCORM navigation requests for flow-only courses
            window.electronAPI.log('info', `NAVIGATION FIX: Flow-only course - skipping SCORM navigation requests`);
            return false;
            
        } else {
            // For choice-enabled courses, use the original order
            window.electronAPI.log('info', `NAVIGATION FIX: Choice navigation course - using LMS navigation`);
            
            // Method 1: Try Storyline 360 specific navigation
            if (this.tryStorylineNavigation(contentWindow, direction)) {
                console.log(`Storyline navigation - ${direction}`);
                return true;
            }

            // Method 2: Try Captivate navigation
            if (this.tryCaptivateNavigation(contentWindow, direction)) {
                console.log(`Captivate navigation - ${direction}`);
                return true;
            }

            // Method 3: Try generic button selectors
            const buttonSelectors = direction === 'next' ? [
                'button[title*="next" i]', 'button[aria-label*="next" i]', 'button[id*="next" i]',
                'button[class*="next" i]', '.next-btn', '.btn-next', '.continue', '.forward',
                'button[title*="continue" i]', 'button[aria-label*="continue" i]',
                'input[type="button"][value*="next" i]', 'a[title*="next" i]', '.nav-next',
                '[data-action="next"]', '[data-nav="next"]', '#nextBtn', '#next-button'
            ] : [
                'button[title*="previous" i]', 'button[aria-label*="previous" i]', 'button[id*="prev" i]',
                'button[class*="prev" i]', '.prev-btn', '.btn-prev', '.previous', '.back',
                'button[title*="back" i]', 'button[aria-label*="back" i]',
                'input[type="button"][value*="previous" i]', 'a[title*="previous" i]', '.nav-prev',
                '[data-action="previous"]', '[data-nav="previous"]', '#prevBtn', '#prev-button'
            ];

            for (const selector of buttonSelectors) {
                try {
                    const button = contentDocument?.querySelector(selector);
                    if (button && !button.disabled && button.offsetParent !== null) {
                        button.click();
                        console.log(`Generic navigation - ${direction} via ${selector}`);
                        return true;
                    }
                } catch (e) {
                    // Continue to next selector
                }
            }

            // Method 4: Try SCORM navigation request for choice courses
            return this.tryScormNavigation(contentWindow, direction);
        }
    }

    tryStorylineNavigation(contentWindow, direction) {
        try {
            // Storyline 360 courses often have global navigation functions
            if (contentWindow.parent && contentWindow.parent.GetPlayer) {
                const player = contentWindow.parent.GetPlayer();
                if (direction === 'next' && player.NextSlide) {
                    player.NextSlide();
                    return true;
                } else if (direction === 'previous' && player.PrevSlide) {
                    player.PrevSlide();
                    return true;
                }
            }

            // Try Storyline's window.parent approach
            if (contentWindow.GetPlayer) {
                const player = contentWindow.GetPlayer();
                if (direction === 'next' && player.NextSlide) {
                    player.NextSlide();
                    return true;
                } else if (direction === 'previous' && player.PrevSlide) {
                    player.PrevSlide();
                    return true;
                }
            }
        } catch (e) {
            // Continue to other methods
        }
        return false;
    }

    tryCaptivateNavigation(contentWindow, direction) {
        try {
            // Adobe Captivate navigation
            if (contentWindow.cpAPIInterface) {
                if (direction === 'next') {
                    contentWindow.cpAPIInterface.next();
                    return true;
                } else if (direction === 'previous') {
                    contentWindow.cpAPIInterface.previous();
                    return true;
                }
            }
        } catch (e) {
            // Continue to other methods
        }
        return false;
    }

    tryScormNavigation(contentWindow, direction) {
        try {
            const scormApi = contentWindow.API || contentWindow.API_1484_11;
            if (scormApi) {
                // CRITICAL FIX: Check if this is a flow-only course first
                const isFlowOnly = this.isFlowOnlyCourse();
                
                if (isFlowOnly) {
                    // For flow-only courses, navigation should be handled by the course content itself
                    // The LMS navigation buttons should NOT send SCORM navigation requests
                    console.log(`SCORM Navigation: Flow-only course detected - navigation handled by course content`);
                    window.electronAPI.log('info', `NAVIGATION FIX: Flow-only course - LMS buttons should not override course navigation`);
                    return false; // Let the course handle its own navigation
                } else {
                    // For choice-enabled courses, LMS can send navigation requests
                    const navRequest = direction === 'next' ? 'continue' : 'previous';
                    scormApi.SetValue('adl.nav.request', navRequest);
                    scormApi.Commit('');
                    console.log(`SCORM API navigation request - ${navRequest} (choice navigation)`);
                    window.electronAPI.log('info', `NAVIGATION FIX: Choice navigation - sent ${navRequest} request`);
                    return true;
                }
            }
        } catch (e) {
            window.electronAPI.log('error', `NAVIGATION FIX: SCORM navigation error: ${e.message}`);
        }
        return false;
    }

    sendKeyboardNavigation(frame, keyCode) {
        try {
            const contentDocument = frame.contentDocument;
            const contentWindow = frame.contentWindow;
            
            // Send keyboard event to the course
            const event = new contentWindow.KeyboardEvent('keydown', {
                key: keyCode,
                code: keyCode,
                bubbles: true,
                cancelable: true
            });
            
            contentDocument.dispatchEvent(event);
            console.log(`Keyboard navigation attempted - ${keyCode}`);
        } catch (e) {
            console.log('Keyboard navigation failed:', e.message);
        }
    }

    // NAVIGATION FIX: Helper method to detect flow-only courses
    isFlowOnlyCourse() {
        try {
            // Check if we have course structure information
            const courseInfo = this.currentCourseInfo;
            if (courseInfo && courseInfo.courseStructure) {
                const isFlowOnly = courseInfo.courseStructure.isFlowOnly;
                window.electronAPI.log('info', `NAVIGATION FIX: Flow-only detection from courseStructure: ${isFlowOnly}`);
                return isFlowOnly;
            }
            
            // Fallback: Check if course outline has flow-only indicators
            const outlineItems = document.querySelectorAll('.lms-outline-item.flow-only');
            const hasFlowOnlyItems = outlineItems.length > 0;
            window.electronAPI.log('info', `NAVIGATION FIX: Flow-only detection from DOM: ${hasFlowOnlyItems}`);
            return hasFlowOnlyItems;
        } catch (e) {
            window.electronAPI.log('warn', `NAVIGATION FIX: Error detecting flow-only course: ${e.message}`);
            return false; // Default to choice navigation if uncertain
        }
    }

    updateNavigationStatus() {
        const lmsNavTitle = document.getElementById('lmsNavTitle');
        const lmsNavStatus = document.getElementById('lmsNavStatus');
        const lmsNavPrev = document.getElementById('lmsNavPrev');
        const lmsNavNext = document.getElementById('lmsNavNext');

        if (this.currentCoursePath) {
            lmsNavTitle.textContent = 'SCORM Course Player';
            lmsNavStatus.textContent = 'Course loaded and active';
            lmsNavPrev.disabled = false;
            lmsNavNext.disabled = false;
        } else {
            lmsNavTitle.textContent = 'Learning Management System';
            lmsNavStatus.textContent = 'No course loaded';
            lmsNavPrev.disabled = true;
            lmsNavNext.disabled = true;
        }
    }

    waitForCourseReady() {
        const frame = this.elements.previewFrame;
        if (!frame || !frame.contentWindow) return;

        const checkReady = (attempts = 0) => {
            if (attempts > 20) return; // Stop after 20 attempts (10 seconds)

            try {
                const contentWindow = frame.contentWindow;
                
                // Check if Storyline player is ready
                if (contentWindow.GetPlayer || (contentWindow.parent && contentWindow.parent.GetPlayer)) {
                    console.log('Storyline course detected and ready for navigation');
                    const lmsNavStatus = document.getElementById('lmsNavStatus');
                    lmsNavStatus.textContent = 'Storyline course ready';
                    return;
                }

                // Check if Captivate is ready
                if (contentWindow.cpAPIInterface) {
                    console.log('Captivate course detected and ready for navigation');
                    const lmsNavStatus = document.getElementById('lmsNavStatus');
                    lmsNavStatus.textContent = 'Captivate course ready';
                    return;
                }

                // Check if course has navigation buttons loaded
                const contentDocument = frame.contentDocument;
                const hasNavButtons = contentDocument?.querySelector('button, input[type="button"], .btn, [role="button"]');
                if (hasNavButtons) {
                    console.log('Course with navigation buttons detected');
                    const lmsNavStatus = document.getElementById('lmsNavStatus');
                    lmsNavStatus.textContent = 'Course navigation ready';
                    return;
                }

                // Wait and try again
                setTimeout(() => checkReady(attempts + 1), 500);
            } catch (e) {
                // Wait and try again
                setTimeout(() => checkReady(attempts + 1), 500);
            }
        };

        checkReady();
    }

    populateCourseOutline(courseStructure, courseInfo) { // Modified signature
        const outlineContent = document.getElementById('lmsOutlineContent');
        if (!outlineContent) return;

        try {
            window.electronAPI.log('info', '=== NAVIGATION DEBUG: populateCourseOutline called ===');
            window.electronAPI.log('info', 'NAVIGATION DEBUG: courseStructure received:', JSON.stringify(courseStructure, null, 2));
            window.electronAPI.log('info', 'NAVIGATION DEBUG: courseInfo received:', JSON.stringify(courseInfo, null, 2));
            
            // Clear existing content
            outlineContent.innerHTML = '';

            if (!courseStructure || !courseStructure.items || courseStructure.items.length === 0) {
                window.electronAPI.log('warn', 'NAVIGATION DEBUG: No course structure items found, creating fallback');
                // Create a default structure for single SCO courses
                courseStructure = [{
                    id: 'main',
                    title: courseInfo.title || 'Course Content',
                    type: 'sco',
                    completed: false,
                    active: true
                }];
                window.electronAPI.log('info', 'NAVIGATION DEBUG: Fallback structure created:', courseStructure);
            } else {
                window.electronAPI.log('info', 'NAVIGATION DEBUG: Using actual course structure with', courseStructure.items.length, 'items');
                window.electronAPI.log('info', 'NAVIGATION DEBUG: Item titles:', courseStructure.items.map(i => i.title));
                window.electronAPI.log('info', 'NAVIGATION DEBUG: Item identifiers:', courseStructure.items.map(i => i.identifier));
                window.electronAPI.log('info', 'NAVIGATION DEBUG: Item visibility:', courseStructure.items.map(i => ({ title: i.title, isVisible: i.isVisible })));
            }

            // Determine which structure to use for population
            const itemsToPopulate = courseStructure.items || courseStructure;
            window.electronAPI.log('info', 'NAVIGATION DEBUG: Items to populate:', itemsToPopulate.length, 'items');
            window.electronAPI.log('info', 'NAVIGATION DEBUG: Items details:', JSON.stringify(itemsToPopulate, null, 2));

            // Check if this is a flow-only course for styling
            const isFlowOnly = courseInfo.courseStructure && courseInfo.courseStructure.isFlowOnly;
            
            // Populate the outline
            itemsToPopulate.forEach((item, index) => {
                window.electronAPI.log('info', `NAVIGATION DEBUG: Creating outline item ${index + 1}: ${item.title}`);
                
                const outlineItem = document.createElement('div');
                outlineItem.className = 'lms-outline-item';
                outlineItem.dataset.itemId = item.identifier || item.id;
                
                if (item.active === true) {
                    outlineItem.classList.add('active');
                }
                if (item.completed === true) {
                    outlineItem.classList.add('completed');
                }
                
                // Add flow-only styling if applicable
                if (isFlowOnly) {
                    outlineItem.classList.add('flow-only');
                    outlineItem.title = 'Sequential navigation course - use Previous/Next buttons to navigate';
                }

                // Use clean titles without icons or generic labels to match real LMS behavior
                const navigationIcon = isFlowOnly ? '🔒' : '';
                outlineItem.innerHTML = `
                    <div class="lms-outline-item-title">${navigationIcon} ${this.escapeHtml(item.title)}</div>
                    <div class="lms-outline-item-meta">${this.detectItemType(item.title) === 'assessment' ? 'Quiz' : 'Lesson'}${isFlowOnly ? ' • Sequential' : ''}</div>
                `;

                // Add click handler for navigation
                outlineItem.addEventListener('click', () => {
                    window.electronAPI.log('info', `NAVIGATION DEBUG: Outline item clicked - ID: ${item.identifier || item.id}, Title: ${item.title}`);
                    
                    if (isFlowOnly) {
                        // Show user-friendly notification for flow-only courses
                        this.showNavigationNotification(item.title);
                        window.electronAPI.log('info', `NAVIGATION DEBUG: Flow-only course - showing notification instead of navigating`);
                    } else {
                        // For courses that support choice navigation, attempt navigation
                        window.electronAPI.log('info', `NAVIGATION DEBUG: Choice navigation supported - attempting navigation`);
                        this.navigateToOutlineItem(item.identifier || item.id);
                    }
                });

                outlineContent.appendChild(outlineItem);
                window.electronAPI.log('info', `NAVIGATION DEBUG: Added outline item: ${item.title}`);
            });

            // Update progress
            this.updateCourseProgress(itemsToPopulate);
            
            window.electronAPI.log('info', 'NAVIGATION DEBUG: Course outline population completed');
            window.electronAPI.log('info', '=== NAVIGATION DEBUG: populateCourseOutline finished ===');

        } catch (error) {
            window.electronAPI.log('error', 'NAVIGATION DEBUG: Error populating course outline:', error);
            // Fallback display
            outlineContent.innerHTML = `
                <div class="lms-outline-item active">
                    <div class="lms-outline-item-title">${this.escapeHtml(courseInfo.title || 'Course Content')}</div>
                    <div class="lms-outline-item-meta">SCORM Package</div>
                </div>
            `;
        }
    }

    detectItemType(title) {
        if (!title) return 'sco';
        const lowerTitle = title.toLowerCase();
        return (lowerTitle.includes('quiz') || lowerTitle.includes('test') || lowerTitle.includes('assessment')) ? 'assessment' : 'sco';
    }

    showNavigationNotification(itemTitle) {
        // Create and show a user-friendly notification
        const notification = document.createElement('div');
        notification.className = 'navigation-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">ℹ️</div>
                <div class="notification-text">
                    <strong>Sequential Navigation Course</strong><br>
                    "${itemTitle}" will be available when you reach it in sequence.<br>
                    Use the Previous/Next buttons to navigate through the course.
                </div>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        // Add notification styles if not already present
        if (!document.getElementById('navigationNotificationStyles')) {
            const styles = document.createElement('style');
            styles.id = 'navigationNotificationStyles';
            styles.textContent = `
                .navigation-notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #fff3cd;
                    border: 1px solid #ffeaa7;
                    border-radius: 8px;
                    padding: 0;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 10000;
                    max-width: 350px;
                    animation: slideInRight 0.3s ease-out;
                }
                
                .notification-content {
                    display: flex;
                    align-items: flex-start;
                    padding: 15px;
                    gap: 12px;
                }
                
                .notification-icon {
                    font-size: 20px;
                    flex-shrink: 0;
                }
                
                .notification-text {
                    flex: 1;
                    font-size: 13px;
                    line-height: 1.4;
                    color: #856404;
                }
                
                .notification-close {
                    background: none;
                    border: none;
                    font-size: 18px;
                    cursor: pointer;
                    color: #856404;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                
                .notification-close:hover {
                    background: rgba(133, 100, 4, 0.1);
                    border-radius: 50%;
                }
                
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    navigateToOutlineItem(itemId) {
        window.electronAPI.log('info', `NAVIGATION DEBUG: navigateToOutlineItem called with itemId: ${itemId}`);
        
        // Update active state in outline
        const outlineItems = document.querySelectorAll('.lms-outline-item');
        window.electronAPI.log('info', `NAVIGATION DEBUG: Found ${outlineItems.length} outline items in DOM`);
        
        outlineItems.forEach(item => {
            const currentItemId = item.dataset.itemId;
            window.electronAPI.log('info', `NAVIGATION DEBUG: Checking item with dataset.itemId: ${currentItemId}`);
            
            if (currentItemId === itemId) {
                item.classList.add('active');
                window.electronAPI.log('info', `NAVIGATION DEBUG: Set item ${currentItemId} as active`);
            } else {
                item.classList.remove('active');
            }
        });

        // For courses that support choice navigation, implement actual navigation
        window.electronAPI.log('info', `NAVIGATION DEBUG: Attempting navigation to item: ${itemId}`);
        
        // Try to navigate using SCORM navigation request
        const frame = this.elements.previewFrame;
        if (frame && frame.contentWindow) {
            try {
                const contentWindow = frame.contentWindow;
                const scormApi = contentWindow.API || contentWindow.API_1484_11;
                
                if (scormApi) {
                    // For SCORM 2004, try navigation request
                    scormApi.SetValue('adl.nav.request', `choice.{target=${itemId}}`);
                    scormApi.Commit('');
                    window.electronAPI.log('info', `NAVIGATION DEBUG: SCORM navigation request sent for ${itemId}`);
                } else {
                    window.electronAPI.log('warn', `NAVIGATION DEBUG: No SCORM API found in course frame`);
                }
            } catch (error) {
                window.electronAPI.log('error', `NAVIGATION DEBUG: Navigation error: ${error.message}`);
            }
        }
        
        // CRITICAL FIX: Instantiate the EnhancedScormPreview and assign to window.scormPreview
        document.addEventListener('DOMContentLoaded', function() {
            window.scormPreview = new EnhancedScormPreview();
        });
        
        console.log(`Navigate to course item: ${itemId}`);
    }

    updateCourseProgress(courseStructure) {
        const totalItems = courseStructure.length;
        const completedItems = courseStructure.filter(item => item.completed).length;
        const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

        const progressFill = document.getElementById('lmsProgressFill');
        const progressText = document.getElementById('lmsProgressText');

        if (progressFill) {
            progressFill.style.width = `${progressPercent}%`;
            progressFill.textContent = `${progressPercent}%`;
        }

        if (progressText) {
            progressText.textContent = `${completedItems} of ${totalItems} completed`;
        }
    }

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    showCourseOutlineByDefault() {
        // Show the course outline by default when course loads (like real LMS)
        const lmsCourseOutline = document.getElementById('lmsCourseOutline');
        const lmsNavMenu = document.getElementById('lmsNavMenu');
        
        if (lmsCourseOutline && lmsNavMenu) {
            lmsCourseOutline.classList.add('show');
            lmsNavMenu.textContent = '✕ Close';
        }
    }
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
    window.scormPreview = new EnhancedScormPreview();
    window.scormApp = window.scormPreview; // Keep backward compatibility
});