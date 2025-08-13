import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';

test('loads ZIP course and displays content iframe (diagnostic)', async () => {
  const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');
  const extractedPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004');

  // Launch Electron using the project's installed binary to avoid environment mismatches.
  const electronApp = await electron.launch({ executablePath: require('electron'), args: ['.'] });
  const page = await electronApp.firstWindow();

  // Diagnostic 1: Inspect what electronAPI exists before stubbing
  const beforeApi = await page.evaluate(() => {
    try {
      const api = (window as any).electronAPI;
      return {
        exists: !!api,
        keys: api ? Object.keys(api) : [],
        selectScormPackageType: api && api.selectScormPackage ? typeof api.selectScormPackage : null
      };
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log('Diagnostic - electronAPI before stub:', JSON.stringify(beforeApi));

  // Install a stubbed electronAPI to make the flow deterministic in tests.
  await page.evaluate(({ zipPath, extractedPath }) => {
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

  // Diagnostic 2: Confirm stub installed
  const afterApi = await page.evaluate(() => {
    try {
      const api = (window as any).electronAPI;
      return {
        exists: !!api,
        keys: api ? Object.keys(api) : [],
        selectScormPackageType: api && api.selectScormPackage ? typeof api.selectScormPackage : null
      };
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log('Diagnostic - electronAPI after stub:', JSON.stringify(afterApi));

  // Ensure the Load button exists and click it.
  await page.waitForSelector('#course-load-btn', { timeout: 5000 });
  await page.click('#course-load-btn');

  // Increase timeout for manifest/process work and wait for iframe src to contain the launch page.
  const waitResult = await page.waitForFunction(() => {
    const iframe = document.getElementById('content-frame') as HTMLIFrameElement | null;
    return iframe && typeof iframe.src === 'string' && iframe.src.indexOf('story.html') !== -1;
  }, null, { timeout: 60000 }).catch(e => ({ error: String(e) }));

  console.log('Diagnostic - waitResult:', JSON.stringify(waitResult));

  const src = await page.evaluate(() => {
    const iframe = document.getElementById('content-frame') as HTMLIFrameElement | null;
    return iframe ? iframe.src : null;
  });
  console.log('Diagnostic - iframe src after wait:', src);

  // Assert that the iframe loaded the expected launch URL
  expect(src).toContain('story.html');

  await electronApp.close();
});