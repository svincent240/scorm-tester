/**
 * Initial UI State - extracted from ui-state.js to reduce file size.
 * Pure data factory with no side effects.
 */

export function getInitialUIState() {
  return {
    // Session state
    currentSession: null,
    sessionStartTime: null,
    isConnected: true,

    // Course state
    courseInfo: null,
    courseStructure: null,
    currentCoursePath: null,
    entryPoint: null,

    // Navigation state
    navigationState: {
      canNavigatePrevious: false,
      canNavigateNext: false,
      currentItem: null,
      isFlowOnly: false,
      menuVisible: false
    },

    // Progress state
    progressData: {
      completionStatus: 'not attempted',
      successStatus: 'unknown',
      scoreRaw: null,
      progressMeasure: 0,
      sessionTime: '00:00:00',
      totalTime: '00:00:00',
      location: null,
      suspendData: null
    },

    // UI state
    ui: {
      theme: 'default',
      sidebarCollapsed: false,
      sidebarVisible: true,
      courseOutlineVisible: false,
      devModeEnabled: false,
      loading: false,
      error: null,
      notifications: []
    },

    // Testing mode state
    testingMode: {
      enabled: false,
      overrides: {
        bypassSequencing: false,
        forceNavigation: false,
        ignorePrerequisites: false,
        unlimitedAttempts: false
      },
      testStates: new Map()
    },

    // LMS simulation state
    lmsProfile: null,
    networkDelay: 0,

    // Debug state
    apiCallHistory: [],
    maxApiCallHistory: 500,
    debug: {
      // placeholders for diagnostics and logger view snapshots
      lastEvents: [],
      maxEvents: 200,
      lastLogs: [],
      maxLogs: 500
    }
  };
}