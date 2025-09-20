/**
 * @jest-environment jsdom
 */

// Mock Electron surface used by renderer code
jest.mock('electron', () => ({
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() },
  contextBridge: { exposeInMainWorld: jest.fn() }
}));

// Silence console (renderer code should not use console directly)
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

function ensureRoot(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

describe('CourseOutline HTML escaping of item titles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();

    // Minimal electronAPI to satisfy dynamic imports in renderer
    window.electronAPI = {
      rendererBaseUrl: '../',
      getCourseOutlineActivityTree: jest.fn().mockResolvedValue({ success: true, data: { id: 'root', children: [] } }),
      getCourseOutlineAvailableNavigation: jest.fn().mockResolvedValue({ success: true, data: [] }),
      validateCourseOutlineChoice: jest.fn().mockResolvedValue({ success: true, allowed: true }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    };

    ensureRoot('outline-root');
  });

  test('renders malicious titles as inert escaped text', async () => {
    const { CourseOutline } = await import('../../../src/renderer/components/scorm/course-outline.js');
    const { escapeHTML } = await import('../../../src/renderer/utils/escape.js');

    const maliciousTitle = "<img src=x onerror=alert(1)>Hello<script>alert(2)</script>&";
    const expectedEscaped = escapeHTML(maliciousTitle);

    const outline = new CourseOutline('outline-root', { autoRender: false, enableNavigation: false });
    await outline.initialize?.().catch(() => {});

    outline.renderContent();
    outline.setCourseStructure({
      identifier: 'course-1',
      items: [
        { identifier: 'item-1', type: 'sco', title: maliciousTitle }
      ]
    });

    const rootEl = document.getElementById('outline-root');
    const titleEl = rootEl.querySelector('.outline-item__title');

    expect(titleEl).toBeTruthy();

    // Ensure no DOM injection occurred
    expect(titleEl.querySelector('script, img')).toBeNull();

    // The DOM should contain the escaped entities (innerHTML) while textContent shows literal characters
    expect(titleEl.innerHTML).toContain(expectedEscaped);
    expect(titleEl.textContent.replace(/\s+/g, ' ').trim()).toContain(maliciousTitle);
  });
});

