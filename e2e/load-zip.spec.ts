import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';

test('loads ZIP course and displays content iframe', async () => {
  const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');
  const extractedPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004');

  const electronApp = await electron.launch({ args: ['.'] });
  const page = await electronApp.firstWindow();

  // Stub electron API used by the renderer to avoid complex IPC and native file dialogs.
  await page.evaluate(({ zipPath, extractedPath }) => {
    // Attach a test stub to the renderer window. Cast to any to avoid TypeScript DOM type errors.
    (window as any).electronAPI = {
      selectScormPackage: async () => ({ success: true, filePath: zipPath }),
      selectScormFolder: async () => ({ success: true, folderPath: extractedPath }),
      pathUtils: {
        prepareCourseSource: async (_args: any) => ({ success: true, unifiedPath: extractedPath }),
        resolveScormUrl: async (href: any) => ({ success: true, resolvedPath: `${extractedPath}/${href}`, url: `file://${extractedPath}/${href}` })
      },
      getCourseManifest: async (_p: any) => ({ success: true, manifestContent: '<manifest/>' }),
      processScormManifest: async (_p: any, _content: any) => ({
        success: true,
        manifest: {
          identifier: 'course1',
          organizations: { organization: { title: 'SL360 Course', identifier: 'org1' }, default: null },
          metadata: { schemaversion: 'SCORM 2004' }
        },
        validation: { valid: true, errors: [] },
        analysis: {
          launchSequence: [{ href: 'story.html' }],
          uiOutline: [{ identifier: 'item1', title: 'Lesson 1', href: 'story.html' }],
          manifest: {}
        }
      })
    };
  }, { zipPath, extractedPath });

  // Trigger the Load ZIP UI
  await page.click('#course-load-btn');

  // Wait for the content iframe to load the resolved launch URL
  await page.waitForFunction(() => {
    const iframe = document.getElementById('content-frame') as HTMLIFrameElement | null;
    return iframe && iframe.src && iframe.src.indexOf('story.html') !== -1;
  }, null, { timeout: 10000 });

  const src = await page.evaluate(() => {
    const iframe = document.getElementById('content-frame') as HTMLIFrameElement | null;
    return iframe ? iframe.src : '';
  });
  expect(src).toContain('story.html');

  await electronApp.close();
});