/**
 * CAM ↔ Validator Contract Tests (minimal non-breaking scaffold)
 * - Use only public CAM entrypoint and validate manifest-level contracts
 * - Deterministic fixtures; no production code changes
 */

const path = require('path');
const fs = require('fs');
const CAM = require('../../../src/main/services/scorm/cam/index.js');

function readXml(relPath) {
  const p = path.join(__dirname, '../../..', 'fixtures', relPath);
  return fs.readFileSync(p, 'utf8');
}

describe('Contract: CAM ↔ Validator', () => {
  test('valid minimal manifest passes parse and basic validation', async () => {
    const xml = readXml(path.join('manifests', 'minimal', 'valid-minimal.xml'));
    const result = await CAM.parseManifestFromString(xml);

    // Contract-level assertions (do not overfit internal structure)
    expect(result).toBeDefined();
    expect(result.errors || []).toEqual([]);
    expect(result.organizations && result.organizations.length).toBeGreaterThan(0);
    expect(result.resources && result.resources.length).toBeGreaterThan(0);
  });

  test('missing resource manifest yields validation errors (non-zero)', async () => {
    const xml = readXml(path.join('manifests', 'invalid', 'missing-resource.xml'));
    const result = await CAM.parseManifestFromString(xml);

    // We assert presence of errors without asserting exact messages/codes
    const errs = result.errors || [];
    expect(Array.isArray(errs)).toBe(true);
    expect(errs.length).toBeGreaterThan(0);
  });
});