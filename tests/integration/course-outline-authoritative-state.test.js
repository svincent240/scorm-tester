/**
 * @jest-environment jsdom
 *
 * CourseOutline authoritative state gating: no navigation until SCORM states loaded
 */

// Mock Electron modules minimal surface
jest.mock('electron', () => ({
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() },
  contextBridge: { exposeInMainWorld: jest.fn() }
}));

// Silence console (renderer should not use console)
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

const ensureRoot = (id) => {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
};

describe('CourseOutline authoritative state gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureRoot('outline-root');
    window.electronAPI = {
      rendererBaseUrl: '../',
      getCourseOutlineActivityTree: jest.fn().mockResolvedValue({ success: true, data: { id: 'root', children: [] } }),
      getCourseOutlineAvailableNavigation: jest.fn().mockResolvedValue({ success: true, data: [] }),
      validateCourseOutlineChoice: jest.fn().mockResolvedValue({ success: true, allowed: true }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    };
  });

  test('outline items are disabled and navigationRequest is not emitted before states load', async () => {
    const eventBusMod = await import('../../src/renderer/services/event-bus.js');
    const eventBus = eventBusMod.eventBus || eventBusMod.default || eventBusMod;
    const emitSpy = jest.spyOn(eventBus, 'emit');

    const { CourseOutline } = await import('../../src/renderer/components/scorm/course-outline.js');
    const outline = new CourseOutline('outline-root', { autoRender: false });
    await outline.initialize?.().catch(() => {});

    // Set course structure but do NOT simulate scormStatesLoaded
    outline.renderContent();
    outline.setCourseStructure({ identifier: 'course', items: [{ identifier: 'sco-1', title: 'SCO 1', type: 'sco' }] });

    // Try to navigate before states load
    await outline.navigateToItem('sco-1');

    // Should not emit navigationRequest when scormStatesLoaded is false
    expect(emitSpy.mock.calls.find(c => c[0] === 'navigationRequest')).toBeUndefined();

    // Rendered item should have disabled class applied when not loaded
    const rootEl = document.getElementById('outline-root');
    const disabledEls = rootEl.querySelectorAll('.outline-item--disabled');
    expect(disabledEls.length).toBeGreaterThan(0);
  });
});

