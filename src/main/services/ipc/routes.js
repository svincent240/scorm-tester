module.exports = [
  {
    channel: 'open-scorm-inspector-window',
    handlerName: 'handleOpenScormInspectorWindow',
    options: {
      singleFlight: true,
      debounceMs: 500,
      rateLimitProfile: 'uiSparse'
    }
  },
  {
    channel: 'scorm-inspector-get-history',
    handlerName: 'handleScormInspectorGetHistory',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'scorm-initialize',
    handlerName: 'handleScormInitialize',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'scorm-get-value',
    handlerName: 'handleScormGetValue',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'scorm-set-value',
    handlerName: 'handleScormSetValue',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'scorm-commit',
    handlerName: 'handleScormCommit',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'scorm-terminate',
    handlerName: 'handleScormTerminate',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'select-scorm-package',
    handlerName: 'handleSelectScormPackage',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'select-scorm-folder',
    handlerName: 'handleSelectScormFolder',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'extract-scorm',
    handlerName: 'handleExtractScorm',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
{
    channel: 'prepare-course-source',
    handlerName: 'handlePrepareCourseSource',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'save-temporary-file',
    handlerName: 'handleSaveTemporaryFile',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'find-scorm-entry',
    handlerName: 'handleFindScormEntry',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'get-course-info',
    handlerName: 'handleGetCourseInfo',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'get-course-manifest',
    handlerName: 'handleGetCourseManifest',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'process-scorm-manifest',
    handlerName: 'handleProcessScormManifest',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'get-session-data',
    handlerName: 'handleGetSessionData',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'reset-session',
    handlerName: 'handleResetSession',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'get-all-sessions',
    handlerName: 'handleGetAllSessions',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'sn:getStatus',
    handlerName: 'handleSNGetStatus',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'sn:getSequencingState',
    handlerName: 'handleSNGetSequencingState',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'sn:initialize',
    handlerName: 'handleSNInitialize',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'sn:processNavigation',
    handlerName: 'handleSNProcessNavigation',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'sn:updateActivityProgress',
    handlerName: 'handleSNUpdateActivityProgress',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'sn:reset',
    handlerName: 'handleSNReset',
    options: {
      rateLimitProfile: 'snBypass'
    }
  },
  {
    channel: 'apply-lms-profile',
    handlerName: 'handleApplyLmsProfile',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'get-lms-profiles',
    handlerName: 'handleGetLmsProfiles',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'run-test-scenario',
    handlerName: 'handleRunTestScenario',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'open-external',
    handlerName: 'handleOpenExternal',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'path-to-file-url',
    handlerName: 'handlePathUtilsToFileUrl',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'resolve-scorm-url',
    handlerName: 'handleResolveScormUrl',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'path-normalize',
    handlerName: 'handlePathNormalize',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'path-join',
    handlerName: 'handlePathJoin',
    options: {
      rateLimitProfile: 'default'
    }
  },
  {
    channel: 'load-shared-logger-adapter',
    handlerName: 'handleLoadSharedLoggerAdapter',
    options: {
      rateLimitProfile: 'default'
    }
  },
{
    channel: 'recent:get',
    handlerName: 'handleRecentGet',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'recent:addOrUpdate',
    handlerName: 'handleRecentAddOrUpdate',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'recent:remove',
    handlerName: 'handleRecentRemove',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true,
      validateArgs: true
    }
  },
  {
    channel: 'recent:clear',
    handlerName: 'handleRecentClear',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'log-message',
    handlerName: 'handleLogMessage',
    options: {
      rateLimitProfile: 'default'
    }
  },
  // Enhanced SCORM Inspector routes
  {
    channel: 'scorm-inspector-get-activity-tree',
    handlerName: 'handleScormInspectorGetActivityTree',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'scorm-inspector-get-navigation-requests',
    handlerName: 'handleScormInspectorGetNavigationRequests',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'scorm-inspector-get-global-objectives',
    handlerName: 'handleScormInspectorGetGlobalObjectives',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
  {
    channel: 'scorm-inspector-get-ssp-buckets',
    handlerName: 'handleScormInspectorGetSSPBuckets',
    options: {
      rateLimitProfile: 'default',
      useIpcResult: true
    }
  },
];