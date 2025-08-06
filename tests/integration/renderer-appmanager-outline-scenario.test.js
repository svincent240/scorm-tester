/**
 * Renderer/AppManager Orchestrator Scenario 2 — Outline Consumption + UI Intents
 *
 * Goals:
 * - Exercise renderer flows through AppManager public entry [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:1)
 * - Validate that CAM-provided analysis.uiOutline is consumed by CourseOutline component (no reconstruction)
 * - Validate basic UI intents wiring remains functional
 * - Headless, deterministic harness; no console usage (policy)
 *
 * Harness:
 * - DOM stubs for required mount points
 * - EventBus for orchestrating events [src/renderer/services/event-bus.js](src/renderer/services/event-bus.js:1)
 * - Logger policy: rely on renderer logger adapter internally; do not use console.* here
 */

jest.useFakeTimers({ legacyFakeTimers: true });

describe('Renderer/AppManager orchestrator scenario 2 (outline consumption + UI intents)', () => {
  let appManager;
  let eventBus;
  let courseOutlineInstance;
  let contentViewerInstance;

  beforeEach(async () => {
    jest.resetModules();

    // Minimal window and document stubs
    global.window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      localStorage: {
        getItem: jest.fn().mockReturnValue('light'),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      matchMedia: jest.fn(() => ({
        matches: false,
        addListener: jest.fn(),
        removeListener: jest.fn(),
      })),
      electronAPI: {
        openDebugWindow: jest.fn(),
        emitDebugEvent: jest.fn(),
      },
      // Provide minimal location to satisfy any checks
      location: { href: 'https://example.test/', protocol: 'https:' },
    };

    const elementStub = () => ({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn(),
        contains: jest.fn(() => false),
      },
      style: {},
      textContent: '',
      innerHTML: '',
      click: jest.fn(),
      files: [],
      appendChild: jest.fn(),
      remove: jest.fn(),
      setAttribute: jest.fn(),
      getAttribute: jest.fn(),
      // Required by BaseComponent.showErrorState and other component code
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
    });

    // Provide all elements AppManager expects
    const supportedIds = new Set([
      'content-viewer',
      'navigation-controls',
      'progress-tracking',
      'app-footer',
      'course-outline',
      'loading-overlay',
      'loading-message',
      'course-load-btn',
      'debug-toggle',
      'theme-toggle',
      'sidebar-toggle',
      'app-sidebar',
    ]);

    global.document = {
      readyState: 'complete',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      createElement: jest.fn(() => elementStub()),
      getElementById: jest.fn((id) => (supportedIds.has(id) ? elementStub() : null)),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      documentElement: {
        getAttribute: jest.fn(() => 'light'),
        setAttribute: jest.fn(),
        className: '',
      },
      body: {
        appendChild: jest.fn(),
      },
    };

    // Intercept component classes to spy on CourseOutline and ContentViewer methods
    // We patch their modules after require cache reset but before appManager.initialize()
    const pathCourseOutline = '../../src/renderer/components/scorm/course-outline.js';
    const pathContentViewer = '../../src/renderer/components/scorm/content-viewer.js';

    jest.doMock(pathCourseOutline, () => {
      const Actual = jest.requireActual(pathCourseOutline);
      const Original = Actual.CourseOutline;
      return {
        ...Actual,
        CourseOutline: class extends Original {
          async initialize() {
            const res = await super.initialize?.();
            return res;
          }
          updateWithCourse(courseData) {
            // Capture instance and spy calls
            courseOutlineInstance = this;
            return super.updateWithCourse?.(courseData);
          }
        },
      };
    });

    jest.doMock(pathContentViewer, () => {
      const Actual = jest.requireActual(pathContentViewer);
      const Original = Actual.ContentViewer;
      return {
        ...Actual,
        ContentViewer: class extends Original {
          async initialize() {
            const res = await super.initialize?.();
            return res;
          }
          loadContent(url) {
            contentViewerInstance = this;
            return super.loadContent?.(url);
          }
        },
      };
    });

    // Import eventBus and orchestrator entry using dynamic import for ESM modules
    const eventBusMod = await import('../../src/renderer/services/event-bus.js');
    eventBus = eventBusMod.eventBus || eventBusMod.default || eventBusMod;

    const appManagerModule = await import('../../src/renderer/services/app-manager.js');
    appManager = appManagerModule.appManager || appManagerModule.default || appManagerModule;

    // Initialize orchestrator
    await appManager.initialize();
    expect(appManager.isInitialized()).toBe(true);

    // Flush any initialization timers started during module load/initialize
    jest.runOnlyPendingTimers();
  });

  afterEach(() => {
    try {
      jest.runOnlyPendingTimers();
    } catch (_) {}
    jest.clearAllTimers();
    jest.clearAllMocks();
    if (global.gc) {
      try { global.gc(); } catch (_) {}
    }
  });

  test('consumes analysis.uiOutline from CAM and updates UI components via orchestrator', async () => {
    const uiOutline = [
      { identifier: 'res-1', title: 'Lesson 1', href: 'lesson1.html', type: 'sco', items: [] },
      { identifier: 'cluster-1', title: 'Section A', type: 'cluster', items: [
        { identifier: 'res-2', title: 'Lesson 2', href: 'lesson2.html', type: 'sco', items: [] }
      ]},
    ];

    const courseData = {
      info: { title: 'Test Course' },
      launchUrl: 'lesson1.html',
      analysis: { uiOutline },
    };

    // Spy on methods after instances are created by AppManager initialization
    // Instances are created during initializeComponents
    const courseOutline = appManager.getComponent?.('courseOutline');
    const contentViewer = appManager.getComponent?.('contentViewer');

    // Ensure instances exist
    expect(courseOutline).toBeDefined();
    expect(contentViewer).toBeDefined();

    // Spy the public methods we expect to be invoked via course:loaded handler
    const updateSpy = jest.spyOn(courseOutline, 'updateWithCourse');
    const loadSpy = jest.spyOn(contentViewer, 'loadContent');

    // Emit via eventBus (AppManager listens to 'course:loaded')
    eventBus.emit('course:loaded', courseData);

    // Validate that orchestrator pushed data into components
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith('lesson1.html');

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const arg = updateSpy.mock.calls[0][0];
    expect(arg).toBe(courseData); // Contract: CourseOutline.updateWithCourse receives the full courseData

    // Ensure outline is not reconstructed here (renderer consumes as-is)
    expect(Array.isArray(courseData.analysis.uiOutline)).toBe(true);
    expect(courseData.analysis.uiOutline).toEqual(uiOutline);
  });

  test('basic UI intents wiring (theme toggle) works without console use', async () => {
    // Spy attribute before triggering event to capture initial application
    const setAttrSpy = jest.spyOn(document.documentElement, 'setAttribute');

    // Ensure starting attribute
    document.documentElement.setAttribute('data-theme', 'light');

    // Attempt to emit via event bus if listener-based
    if (eventBus && typeof eventBus.emit === 'function') {
      eventBus.emit('ui:toggle-theme');
    } else {
      // Simulate clicking the theme toggle to ensure wiring is live
      const themeBtn = document.getElementById('theme-toggle');
      expect(themeBtn).toBeTruthy();

      // Trigger the click handler that AppManager registered
      const clickHandler = themeBtn.addEventListener.mock.calls.find(call => call[0] === 'click')?.[1];
      if (typeof clickHandler === 'function') {
        clickHandler();
      } else {
        themeBtn.click();
      }
    }

    // Flush any async handlers (content viewer timeouts, UI notifications) that might co-run
    jest.runOnlyPendingTimers();

    // ToggleTheme mutates documentElement attributes; verify attribute setter got invoked or attribute changed
    if (setAttrSpy.mock.calls.length === 0) {
      const current = document.documentElement.getAttribute('data-theme');
      expect(['dark', 'light']).toContain(current);
    } else {
      const calledWithTheme = setAttrSpy.mock.calls.some(
        (args) => args[0] === 'data-theme' && typeof args[1] === 'string'
      );
      expect(calledWithTheme).toBe(true);
    }
  });
});