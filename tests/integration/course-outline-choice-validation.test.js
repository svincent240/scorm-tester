/**
 * @jest-environment jsdom
 *
 * CourseOutline choice validation integration test
 */

// Mock Electron modules minimal surface
jest.mock('electron', () => ({
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() },
  contextBridge: { exposeInMainWorld: jest.fn() }
}));

// Silence console (renderer must not use console output)
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// Helper to ensure a root element exists
const ensureRoot = (id) => {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  if (!el.querySelector) el.querySelector = () => null;
  if (!el.querySelectorAll) el.querySelectorAll = () => [];
  if (!el.classList) el.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
  if (!el.addEventListener) el.addEventListener = () => {};
  if (!el.removeEventListener) el.removeEventListener = () => {};
  return el;
};

describe('CourseOutline choice validation', () => {
  let mockSnBridge;
  beforeEach(() => {
    jest.clearAllMocks();
    ensureRoot('outline-root');
    // Provide preload bridge pieces needed by renderer modules (rendererBaseUrl for any dynamic imports)
    window.electronAPI = {
      rendererBaseUrl: '../',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    };
    // Dependency-injected SN bridge for CourseOutline
    mockSnBridge = {
      validateCourseOutlineChoice: jest.fn().mockResolvedValue({ success: true, allowed: false, reason: 'Choice disabled' }),
      getCourseOutlineActivityTree: jest.fn().mockResolvedValue({ success: true, data: { id: 'root', scormState: {}, children: [] } }),
      getCourseOutlineAvailableNavigation: jest.fn().mockResolvedValue({ success: true, data: ['choice'] })
    };
  });

  test('does not emit navigationRequest when validation is not allowed, but does when allowed', async () => {
    // Import event bus and spy on emits
    const eventBusMod = await import('../../src/renderer/services/event-bus.js');
    const eventBus = eventBusMod.eventBus || eventBusMod.default || eventBusMod;
    const emitSpy = jest.spyOn(eventBus, 'emit');

    // Import CourseOutline class
    const { CourseOutline } = await import('../../src/renderer/components/scorm/course-outline.js');

    // Instantiate component
    const outline = new CourseOutline('outline-root', { autoRender: false, snBridge: mockSnBridge });
    // Minimal setup: render base content and set a simple structure
    await outline.initialize?.().catch(() => { /* intentionally empty */ })); // tolerate partial initialize in jsdom
    outline.renderContent();
    outline.setCourseStructure({ identifier: 'course', items: [{ identifier: 'sco-1', title: 'SCO 1', type: 'sco' }] });
    // Simulate authoritative state loaded for this validation-focused test
    outline.scormStatesLoaded = true;

    // Attempt navigation when validation denies
    await outline.navigateToItem('sco-1');

    // Ensure validation was called
    expect(mockSnBridge.validateCourseOutlineChoice).toHaveBeenCalledWith('sco-1');
    // Should NOT emit navigationRequest
    expect(emitSpy.mock.calls.find(c => c[0] === 'navigation:request')).toBeUndefined();

    // Now allow validation and try again
    mockSnBridge.validateCourseOutlineChoice.mockResolvedValueOnce({ success: true, allowed: true, reason: 'ok' });
    await outline.navigateToItem('sco-1');

    // Should emit navigationRequest once allowed
    expect(emitSpy.mock.calls.find(c => c[0] === 'navigation:request')).toBeTruthy();
  });
});

