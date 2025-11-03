/**
 * Unit tests for ContentValidator version validation
 * 
 * Tests the isValidVersion method to ensure it accepts both:
 * - 2-part versions (X.Y) - traditional format
 * - 3-part semantic versions (X.Y.Z) - commonly used in real SCORM packages
 */

const ContentValidator = require('../../../../src/main/services/scorm/cam/content-validator');

describe('ContentValidator - Version Validation', () => {
  let validator;

  beforeEach(() => {
    const mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    validator = new ContentValidator(mockLogger);
  });

  describe('isValidVersion', () => {
    test('should accept 2-part versions (X.Y)', () => {
      expect(validator.isValidVersion('1.0')).toBe(true);
      expect(validator.isValidVersion('1.1')).toBe(true);
      expect(validator.isValidVersion('2.0')).toBe(true);
      expect(validator.isValidVersion('10.5')).toBe(true);
      expect(validator.isValidVersion('99.99')).toBe(true);
    });

    test('should accept 3-part semantic versions (X.Y.Z)', () => {
      expect(validator.isValidVersion('1.0.0')).toBe(true);
      expect(validator.isValidVersion('1.0.1')).toBe(true);
      expect(validator.isValidVersion('2.1.3')).toBe(true);
      expect(validator.isValidVersion('10.5.2')).toBe(true);
      expect(validator.isValidVersion('99.99.99')).toBe(true);
    });

    test('should reject invalid version formats', () => {
      expect(validator.isValidVersion('1')).toBe(false);
      expect(validator.isValidVersion('1.0.0.0')).toBe(false);
      expect(validator.isValidVersion('v1.0')).toBe(false);
      expect(validator.isValidVersion('1.0-beta')).toBe(false);
      expect(validator.isValidVersion('1.x')).toBe(false);
      expect(validator.isValidVersion('abc')).toBe(false);
      expect(validator.isValidVersion('')).toBe(false);
      expect(validator.isValidVersion('1.')).toBe(false);
      expect(validator.isValidVersion('.1')).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(validator.isValidVersion('0.0')).toBe(true);
      expect(validator.isValidVersion('0.0.0')).toBe(true);
      expect(validator.isValidVersion('1.0.0.0')).toBe(false);
      expect(validator.isValidVersion('1.0.')).toBe(false);
      expect(validator.isValidVersion('1..0')).toBe(false);
    });
  });

  describe('validateManifestStructure with version', () => {
    test('should not warn for valid 2-part version', async () => {
      const manifest = {
        identifier: 'TEST',
        version: '1.0',
        organizations: { organizations: [{ identifier: 'ORG-1', title: 'Test' }] },
        resources: []
      };

      await validator.validateManifestStructure(manifest);
      
      const warnings = validator.validationWarnings;
      const versionWarnings = warnings.filter(w => w.includes('version'));
      expect(versionWarnings).toHaveLength(0);
    });

    test('should not warn for valid 3-part semantic version', async () => {
      const manifest = {
        identifier: 'TEST',
        version: '1.0.0',
        organizations: { organizations: [{ identifier: 'ORG-1', title: 'Test' }] },
        resources: []
      };

      await validator.validateManifestStructure(manifest);
      
      const warnings = validator.validationWarnings;
      const versionWarnings = warnings.filter(w => w.includes('version'));
      expect(versionWarnings).toHaveLength(0);
    });

    test('should warn for invalid version format', async () => {
      const manifest = {
        identifier: 'TEST',
        version: '1.0.0.0',
        organizations: { organizations: [{ identifier: 'ORG-1', title: 'Test' }] },
        resources: []
      };

      await validator.validateManifestStructure(manifest);
      
      const warnings = validator.validationWarnings;
      const versionWarnings = warnings.filter(w => w.includes('version'));
      expect(versionWarnings.length).toBeGreaterThan(0);
      expect(versionWarnings[0]).toContain('Invalid manifest version: 1.0.0.0');
    });

    test('should not warn when version is missing', async () => {
      const manifest = {
        identifier: 'TEST',
        organizations: { organizations: [{ identifier: 'ORG-1', title: 'Test' }] },
        resources: []
      };

      await validator.validateManifestStructure(manifest);
      
      const warnings = validator.validationWarnings;
      const versionWarnings = warnings.filter(w => w.includes('version'));
      expect(versionWarnings).toHaveLength(0);
    });
  });
});

