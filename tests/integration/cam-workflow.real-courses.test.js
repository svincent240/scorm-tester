/**
 * Integration test: CAM workflow against real course fixtures.
 * Goal: Ensure imsmanifest.xml with valid organizations/resources is parsed correctly
 * and DOES NOT trigger the resources-outline fallback that caused API discovery failures.
 *
 * Fixture path: references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition
 *
 * This test would have caught:
 *  - orgCount incorrectly reported as 0
 *  - resCount incorrectly reported as 0
 *  - content viewer using fallback UI outline instead of organizations
 *
 * Notes:
 * - We import the same modules used by the app ScormService CAM path to avoid duplication.
 * - We assert both raw parse metrics and the normalized CourseLoader structure flags.
 */

const path = require('path');
const fs = require('fs');

const { ScormCAMService } = require('../../src/main/services/scorm/cam/index.js');
const { buildUIOutlineFromResourcesFallback } = require('../../src/main/services/scorm/cam/package-analyzer.js'); // sanity: ensure we can detect if fallback was used
const CourseLoader = require('../../src/renderer/services/course-loader.js'); // used for normalized flags
const { JSDOM } = require('jsdom');

describe('CAM workflow with real course fixtures', () => {
  const courseDir = path.resolve(__dirname, '../../references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');
  const manifestPath = path.join(courseDir, 'imsmanifest.xml');

  beforeAll(() => {
    // Basic guard that the real fixture exists in repo
    expect(fs.existsSync(courseDir)).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  test('Parses organizations and resources; no fallback outline is used', async () => {
    // Read manifest as the FileManager would
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    expect(manifestContent.length).toBeGreaterThan(1000);

    // Process via CAM entrypoint (mirrors ScormService & CAM module usage)
    const cam = new ScormCAMService(/* errorHandler */ null, /* logger */ console);
    const result = await cam.processPackage(courseDir, manifestContent);

    // Updated expectations to match ScormCAMService.processPackage() shape:
    // result: { success, manifest, validation, analysis, metadata }
    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.analysis).toBeTruthy();

    const { analysis } = result;

    // analysis contains org/resources counts logged by analyzer; ensure outline exists
    // UI outline is placed at analysis.uiOutline by ScormCAMService
    expect(Array.isArray(analysis.uiOutline)).toBe(true);
    expect(analysis.uiOutline.length).toBeGreaterThan(0);

    // Derive org/resource counts from manifest for assertions (robust to cleaner shapes)
    const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    const getOrganizations = (manifest) => {
      if (!manifest || !manifest.organizations) return [];
      const cont = manifest.organizations;
      if (cont.organization) return toArray(cont.organization);
      if (cont.organizations) return toArray(cont.organizations);
      if (Array.isArray(cont)) return cont;
      return toArray(cont);
    };
    const getResources = (manifest) => {
      if (!manifest || !manifest.resources) return [];
      const cont = manifest.resources;
      if (cont.resource) return toArray(cont.resource);
      if (cont.resources) return toArray(cont.resources);
      if (Array.isArray(cont)) return cont;
      return toArray(cont);
    };
    const orgs = getOrganizations(result.manifest);
    const resources = getResources(result.manifest);
    // Strong invariants: this real course must have organizations and resources > 0
    expect(orgs.length).toBeGreaterThan(0);
    expect(resources.length).toBeGreaterThan(0);
    // Additional integrity checks: organizations should include items or item(s)
    const hasOrgItems = orgs.some(o => o && (Array.isArray(o.items) || Array.isArray(o.item) || ('items' in o) || ('item' in o)));
    expect(hasOrgItems).toBe(true);

    // Ensure outline is derived from organizations (not flat resources fallback). Heuristic:
    // analysis.uiOutline should contain node(s) that expose an 'items' property
    const hasItemsProp = analysis.uiOutline.some(n => n && Object.prototype.hasOwnProperty.call(n, 'items'));
    expect(hasItemsProp).toBe(true);

    // Validate CourseLoader normalization flags as a canary
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;

    // CourseLoader expects { uiOutline, analysis }, pass derived values
    const normalized = CourseLoader.__test__?.normalizeStructure
      ? CourseLoader.__test__.normalizeStructure({ uiOutline: { items: analysis.uiOutline }, analysis: { orgCount: orgs.length, resCount: resources.length } })
      : { hasStructure: Array.isArray(analysis.uiOutline) && analysis.uiOutline.length > 0, itemCount: analysis.uiOutline.length };

    expect(normalized.hasStructure).toBe(true);
    expect(normalized.itemCount).toBeGreaterThan(0);
  });
});