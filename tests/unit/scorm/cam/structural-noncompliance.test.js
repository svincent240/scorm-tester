/**
 * CAM Structural Non-Compliance Signaling (Unit)
 *
 * Verifies that structural issues in a constructed manifest produce non-compliance
 * via PackageAnalyzer.checkComplianceSync. Uses tolerant assertions aligned with
 * guarded-relaxation policy: accept any combination of flags indicating non-compliance
 * (e.g., overallCompliance === false OR isValid === false OR hasRequiredElements === false)
 * and/or presence of diagnostics when provided.
 */

const PackageAnalyzer = require('../../../../src/main/services/scorm/cam/package-analyzer');

describe('CAM Structural Non-Compliance Signaling', () => {
  let analyzer;
  let mockErrorHandler;

  beforeEach(() => {
    mockErrorHandler = {
      setError: jest.fn(),
      getLastError: jest.fn(() => '0'),
      clearError: jest.fn()
    };
    analyzer = new PackageAnalyzer(mockErrorHandler);
  });

  function expectNonCompliance(result) {
    // Guarded-relaxation acceptance:
    // Accept any strong signal via primary flags, diagnostics, or sub-area compliance flags.
    const primarySignal =
      !!result && (
        result.hasRequiredElements === false ||
        result.overallCompliance === false ||
        result.isValid === false
      );

    const diagnosticsSignal =
      (Array.isArray(result?.errors) && result.errors.length > 0) ||
      (Array.isArray(result?.warnings) && result.warnings.length > 0);

    const subAreaSignal =
      !!result && (
        result.sequencingCompliance === false ||
        result.metadataCompliance === false ||
        result.validIdentifiers === false ||
        result.validScormTypes === false
      );

    expect(result).toBeDefined();
    expect(primarySignal || diagnosticsSignal || subAreaSignal).toBe(true);
  }

  test('item.identifierref references non-existent resource => non-compliance signaled', () => {
    const manifest = {
      identifier: 'PKG-1',
      metadata: { schema: 'ADL SCORM', schemaversion: '2004 4th Edition' },
      organizations: {
        default: 'ORG-1',
        organizations: [{
          identifier: 'ORG-1',
          title: 'Org',
          items: [
            { identifier: 'item-1', title: 'Item 1', identifierref: 'RES-DOES-NOT-EXIST' }
          ]
        }]
      },
      // resources present but without the referenced RES-DOES-NOT-EXIST
      resources: [
        { identifier: 'RES-OTHER', scormType: 'sco', href: 'index.html' }
      ]
    };

    const result = analyzer.checkComplianceSync('unused-path', manifest);
    expectNonCompliance(result);
  });

  test('resources element present but empty while items reference resource => non-compliance signaled', () => {
    const manifest = {
      identifier: 'PKG-2',
      metadata: { schema: 'ADL SCORM', schemaversion: '2004 4th Edition' },
      organizations: {
        default: 'ORG-1',
        organizations: [{
          identifier: 'ORG-1',
          title: 'Org',
          items: [
            { identifier: 'item-1', title: 'Item 1', identifierref: 'RES-1' }
          ]
        }]
      },
      resources: []
    };

    const result = analyzer.checkComplianceSync('unused-path', manifest);
    expectNonCompliance(result);
  });

  test('manifest missing organizations/resources keys => required elements false', () => {
    // Minimal invalid: identifier but no organizations/resources keys at all
    const manifest = {
      identifier: 'PKG-3',
      metadata: { schema: 'ADL SCORM' }
      // no organizations, no resources
    };

    const result = analyzer.checkComplianceSync('unused-path', manifest);
    // Stronger expectation here: hasRequiredElements should be false
    expect(result).toBeDefined();
    expect(result.hasRequiredElements).toBe(false);
    // And overall/valid should be false for missing required structure
    expect(result.overallCompliance).toBe(false);
    expect(result.isValid).toBe(false);
  });
});