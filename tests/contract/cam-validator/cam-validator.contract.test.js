/**
 * CAM ↔ Validator Contract Tests (minimal non-breaking scaffold)
 * - Use only public CAM entrypoint and validate manifest-level contracts
 * - Deterministic fixtures; no production code changes
 */

const path = require('path');
const fs = require('fs');
// CAM public entry — prefer service's exported helper if available
// Fallback to index.js named export to preserve current structure
let CAM = null;
try {
  CAM = require('../../../src/main/services/scorm/cam/index.js');
} catch (e) {
  CAM = {};
}

function readXml(relPath) {
  const p = path.join(__dirname, '../../..', 'tests', 'fixtures', relPath);
  return fs.readFileSync(p, 'utf8');
}

describe('Contract: CAM ↔ Validator', () => {
  test('valid minimal manifest passes parse and basic validation', async () => {
    const xml = readXml(path.join('manifests', 'minimal', 'valid-minimal.xml'));

    // Resolve parseManifestFromString from any of the public surfaces
    let parseManifestFromString =
      (CAM && CAM.parseManifestFromString)
      || (CAM && CAM.default && CAM.default.parseManifestFromString);
  
    if (typeof parseManifestFromString !== 'function') {
      try {
        // Try service facade
        const svcMod = require('../../../src/main/services/scorm/cam');
        parseManifestFromString =
          svcMod.parseManifestFromString
          || (svcMod.default && svcMod.default.parseManifestFromString);
        if (typeof parseManifestFromString !== 'function') {
          // Fall back to direct ManifestParser wrapper
          const ParserMod = require('../../../src/main/services/scorm/cam/manifest-parser');
          const ManifestParser = ParserMod.ManifestParser || ParserMod.default || ParserMod;
          if (typeof ManifestParser === 'function') {
            parseManifestFromString = async (xmlString) => {
              const parser = new ManifestParser();
              return parser.parseManifestXML(xmlString, '');
            };
          }
        }
      } catch (_) {}
    }
  
    expect(typeof parseManifestFromString).toBe('function');
    const result = await parseManifestFromString(xml);

    // Contract-level assertions (do not overfit internal structure)
    expect(result).toBeDefined();
    expect(result.errors || []).toEqual([]);

    // Flexible shape guards across parser/validator variants
    const orgsLen =
      (Array.isArray(result.organizations) ? result.organizations.length : undefined) ??
      (Array.isArray(result.organizations?.organizations) ? result.organizations.organizations.length : undefined) ??
      (result.hasOrganizations ? 1 : 0);

    const resLen =
      (Array.isArray(result.resources) ? result.resources.length : undefined) ??
      (typeof result.resourceCount === 'number' ? result.resourceCount : undefined) ??
      (result.hasResources ? 1 : 0);

    // Ensure we are asserting on numbers
    expect(typeof orgsLen).toBe('number');
    expect(typeof resLen).toBe('number');

    expect(orgsLen).toBeGreaterThan(0);
    expect(resLen).toBeGreaterThan(0);
  });

  test('missing resource manifest yields ParserError(PARSE_VALIDATION_ERROR)', async () => {
    const { ParserErrorCode } = require('../../../src/shared/errors/parser-error');
    const xml = readXml(path.join('manifests', 'invalid', 'missing-resource.xml'));

    let parseManifestFromString =
      (CAM && CAM.parseManifestFromString)
      || (CAM && CAM.default && CAM.default.parseManifestFromString);

    if (typeof parseManifestFromString !== 'function') {
      try {
        const svcMod = require('../../../src/main/services/scorm/cam');
        parseManifestFromString =
          svcMod.parseManifestFromString
          || (svcMod.default && svcMod.default.parseManifestFromString);
        if (typeof parseManifestFromString !== 'function') {
          const ParserMod = require('../../../src/main/services/scorm/cam/manifest-parser');
          const ManifestParser = ParserMod.ManifestParser || ParserMod.default || ParserMod;
          if (typeof ManifestParser === 'function') {
            parseManifestFromString = async (xmlString) => {
              const parser = new ManifestParser();
              return parser.parseManifestXML(xmlString, '');
            };
          }
        }
      } catch (_) {}
    }

    expect(typeof parseManifestFromString).toBe('function');

    try {
      await parseManifestFromString(xml);
      throw new Error('Expected ParserError to be thrown');
    } catch (e) {
      expect(e && typeof e).toBe('object');
      expect(e.code).toBe(ParserErrorCode.PARSE_VALIDATION_ERROR);
      expect(String(e.message)).toMatch(/identifierref/i);
    }
  });
});