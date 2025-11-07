/**
 * Intentional internal import justification:
 * This test suite validates the CAM manifest parser internals in isolation.
 * Per dev_docs/architecture/testing-architecture.md, unit tests MAY deep-import
 * internal modules to verify low-level behavior, while higher layers (contract/
 * integration/scenario) MUST use public entrypoints. Do not refactor this test
 * to use the service facade; that would change its layer and reduce isolation.
 *
 * SCORM CAM Manifest Parser Unit Tests
 *
 * Comprehensive test suite for the ManifestParser class covering:
 * - XML parsing and validation
 * - Namespace handling
 * - Manifest structure extraction
 * - Error handling and edge cases
 * - SCORM 2004 4th Edition compliance
 *
 * @fileoverview Unit tests for ManifestParser
 */

const ManifestParser = require('../../../../src/main/services/scorm/cam/manifest-parser');
const fs = require('fs').promises;
const path = require('path');

describe('ManifestParser', () => {
  let manifestParser;
  let mockErrorHandler;

  beforeEach(() => {
    mockErrorHandler = {
      setError: jest.fn(),
      getLastError: jest.fn(() => '0')
    };
    manifestParser = new ManifestParser(mockErrorHandler);
  });

  describe('Constructor', () => {
    test('should initialize with error handler', () => {
      expect(manifestParser.errorHandler).toBe(mockErrorHandler);
      expect(manifestParser.parser).toBeDefined();
      expect(manifestParser.namespaces).toBeDefined();
    });

    test('should initialize without error handler', () => {
      const parser = new ManifestParser();
      expect(parser.errorHandler).toBeUndefined();
      expect(parser.parser).toBeDefined();
    });
  });

  describe('parseManifestXML', () => {
    test('should parse valid SCORM manifest', () => {
      const validManifest = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="TEST-MANIFEST" version="1.0">
          <metadata>
            <schema>ADL SCORM</schema>
            <schemaversion>2004 4th Edition</schemaversion>
          </metadata>
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(validManifest);

      expect(result).toBeDefined();
      expect(result.identifier).toBe('TEST-MANIFEST');
      expect(result.version).toBe('1.0');
      expect(result.metadata).toBeDefined();
      expect(result.organizations).toBeDefined();
      expect(result.resources).toBeDefined();
    });

    test('should handle manifest without version', () => {
      const manifestWithoutVersion = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="TEST-MANIFEST">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithoutVersion);

      expect(result.version).toBe('1.0'); // Default version
    });

    test('should throw error for invalid XML', () => {
      const invalidXML = '<manifest><invalid></manifest>';

      expect(() => {
        manifestParser.parseManifestXML(invalidXML);
      }).toThrow();
      expect(mockErrorHandler.setError).toHaveBeenCalled();
    });

    test('should throw error for non-manifest root element', () => {
      const nonManifestXML = `<?xml version="1.0" encoding="UTF-8"?>
        <notmanifest identifier="TEST">
        </notmanifest>`;

      expect(() => {
        manifestParser.parseManifestXML(nonManifestXML);
      }).toThrow(/Invalid manifest: root element must be <manifest>/);
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        '301',
        'Invalid manifest: root element must be <manifest>',
        'parseManifestXML'
      );
    });
  });

  describe('parseManifestFile', () => {
    const testManifestPath = path.join(__dirname, '../../../fixtures/test-manifest.xml');

    beforeEach(async () => {
      // Create test manifest file
      const testManifest = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="FILE-TEST" version="1.0">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>File Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;
      
      await fs.mkdir(path.dirname(testManifestPath), { recursive: true });
      await fs.writeFile(testManifestPath, testManifest, 'utf8');
    });

    afterEach(async () => {
      try {
        await fs.unlink(testManifestPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    test('should parse manifest from file', async () => {
      const result = await manifestParser.parseManifestFile(testManifestPath);

      expect(result).toBeDefined();
      expect(result.identifier).toBe('FILE-TEST');
      expect(result.version).toBe('1.0');
    });

    test('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent.xml');

      await expect(manifestParser.parseManifestFile(nonExistentPath))
        .rejects.toThrow();
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        '301',
        expect.stringContaining('Failed to read manifest:'),
        'parseManifestFile'
      );
    });
  });

  describe('parseMetadata', () => {
    test('should parse metadata section', () => {
      const manifestWithMetadata = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="META-TEST">
          <metadata>
            <schema>ADL SCORM</schema>
            <schemaversion>2004 4th Edition</schemaversion>
            <location>metadata.xml</location>
          </metadata>
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources/>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithMetadata);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.schema).toBe('ADL SCORM');
      expect(result.metadata.schemaversion).toBe('2004 4th Edition');
      expect(result.metadata.location).toBe('metadata.xml');
    });

    test('should handle missing metadata', () => {
      const manifestWithoutMetadata = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="NO-META-TEST">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources/>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithoutMetadata);

      expect(result.metadata).toBeNull();
    });
  });

  describe('parseOrganizations', () => {
    test('should parse organizations section', () => {
      const manifestWithOrgs = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="ORG-TEST">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Primary Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
            <organization identifier="ORG-2">
              <title>Secondary Organization</title>
              <item identifier="ITEM-2" identifierref="RES-2">
                <title>Test Item 2</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
            <resource identifier="RES-2" type="webcontent" href="page2.html">
              <file href="page2.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithOrgs);

      expect(result.organizations).toBeDefined();
      expect(result.organizations.default).toBe('ORG-1');
      expect(result.organizations.organizations).toHaveLength(2);
      expect(result.organizations.organizations[0].identifier).toBe('ORG-1');
      expect(result.organizations.organizations[0].title).toBe('Primary Organization');
    });

    test('should handle missing organizations (strict fail-fast)', () => {
      const manifestWithoutOrgs = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="NO-ORG-TEST">
          <resources/>
        </manifest>`;

      expect(() => manifestParser.parseManifestXML(manifestWithoutOrgs))
        .toThrow(/Manifest missing required organizations element/);
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        '301',
        'Manifest missing required organizations element',
        'parseManifestXML'
      );
    });
  });

  describe('parseResources', () => {
    test('should parse resources section', () => {
      const manifestWithResources = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
                  identifier="RES-TEST">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent"
                      adlcp:scormType="sco" href="sco1.html">
              <file href="sco1.html"/>
              <file href="common.js"/>
            </resource>
            <resource identifier="RES-2" type="webcontent"
                      adlcp:scormType="asset" xml:base="assets/">
              <file href="image.jpg"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithResources);

      expect(result.resources).toBeDefined();
      expect(result.resources).toHaveLength(2);
      
      const scoResource = result.resources[0];
      expect(scoResource.identifier).toBe('RES-1');
      expect(scoResource.type).toBe('webcontent');
      expect(scoResource.scormType).toBe('sco');
      expect(scoResource.href).toBe('sco1.html');
      
      const assetResource = result.resources[1];
      expect(assetResource.identifier).toBe('RES-2');
      expect(assetResource.scormType).toBe('asset');
      expect(assetResource.xmlBase).toBe('assets/');
    });

    test('should handle empty resources (with strict organizations present)', () => {
      const manifestWithEmptyResources = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="EMPTY-RES-TEST">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources/>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithEmptyResources);

      expect(result.resources).toBeDefined();
      expect(result.resources).toHaveLength(0);
    });
  });

  describe('Helper Methods', () => {
    let testElement;

    beforeEach(() => {
      const testXML = `<test>
        <child attribute="value">Child Text</child>
        <multiple>First</multiple>
        <multiple>Second</multiple>
      </test>`;
      const doc = manifestParser.parser.parseFromString(testXML, 'text/xml');
      testElement = doc.documentElement;
    });

    test('getAttribute should return attribute value', () => {
      const childElement = manifestParser.getChildElement(testElement, 'child');
      const result = manifestParser.getAttribute(childElement, 'attribute');
      expect(result).toBe('value');
    });

    test('getAttribute should return null for missing attribute', () => {
      const childElement = manifestParser.getChildElement(testElement, 'child');
      const result = manifestParser.getAttribute(childElement, 'missing');
      expect(result).toBeNull();
    });

    test('getChildElement should return first matching child', () => {
      const result = manifestParser.getChildElement(testElement, 'child');
      expect(result).toBeDefined();
      expect(result.textContent.trim()).toBe('Child Text');
    });

    test('getChildElement should return null for missing child', () => {
      const result = manifestParser.getChildElement(testElement, 'missing');
      expect(result).toBeNull();
    });

    test('getChildElements should return all matching children', () => {
      const result = manifestParser.getChildElements(testElement, 'multiple');
      expect(result).toHaveLength(2);
      expect(result[0].textContent.trim()).toBe('First');
      expect(result[1].textContent.trim()).toBe('Second');
    });

    test('getElementText should return text content', () => {
      const result = manifestParser.getElementText(testElement, 'child');
      expect(result).toBe('Child Text');
    });

    test('getElementText should return null for missing element', () => {
      const result = manifestParser.getElementText(testElement, 'missing');
      expect(result).toBeNull();
    });
  });

  describe('Namespace Handling', () => {
    test('should handle multiple namespaces', () => {
      const namespacedManifest = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
                  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
                  identifier="NS-TEST">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" adlcp:scormType="sco" href="test.html">
              <file href="test.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(namespacedManifest);

      expect(result).toBeDefined();
      expect(result.resources[0].scormType).toBe('sco');
    });
  });

  describe('Error Handling', () => {
    test('should handle XML parsing errors gracefully', () => {
      const malformedXML = '<manifest><unclosed>';

      expect(() => {
        manifestParser.parseManifestXML(malformedXML);
      }).toThrow();
      expect(mockErrorHandler.setError).toHaveBeenCalled();
    });

    test('should handle empty XML', () => {
      const emptyXML = '';

      expect(() => {
        manifestParser.parseManifestXML(emptyXML);
      }).toThrow();
    });

    test('should handle null input', () => {
      expect(() => {
        manifestParser.parseManifestXML(null);
      }).toThrow();
    });
  });

  describe('Edge Cases', () => {
    test('should handle manifest with only required elements (strict org presence)', () => {
      const minimalManifest = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="MINIMAL">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources/>
        </manifest>`;

      const result = manifestParser.parseManifestXML(minimalManifest);

      expect(result.identifier).toBe('MINIMAL');
      expect(result.version).toBe('1.0');
      expect(result.organizations).toBeDefined();
      expect(result.resources).toHaveLength(0);
    });

    test('should handle very large identifiers', () => {
      const longId = 'A'.repeat(4000); // Maximum allowed length
      const manifestWithLongId = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="${longId}">
          <organizations>
            <organization identifier="ORG-1">
              <title>X</title>
            </organization>
          </organizations>
          <resources/>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithLongId);

      expect(result.identifier).toBe(longId);
    });

    test('should handle special characters in text content', () => {
      const manifestWithSpecialChars = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="SPECIAL-CHARS">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test &amp; Special "Chars" &lt;Title&gt;</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithSpecialChars);

      expect(result.organizations.organizations[0].title)
        .toBe('Test & Special "Chars" <Title>');
    });
  });

  describe('Presentation Parsing (ADL Navigation)', () => {
    test('should parse hideLMSUI settings from manifest', () => {
      const manifestWithPresentation = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
                  identifier="TEST-MANIFEST" version="1.0">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
                <adlnav:presentation>
                  <adlnav:navigationInterface>
                    <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
                  </adlnav:navigationInterface>
                </adlnav:presentation>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithPresentation);

      expect(result.organizations.organizations[0].items).toHaveLength(1);
      const item = result.organizations.organizations[0].items[0];
      expect(item.presentation).toBeDefined();
      expect(item.presentation.navigationInterface).toBeDefined();
      expect(item.presentation.navigationInterface.hideLMSUI).toEqual(['previous', 'continue']);
    });

    test('should handle items without presentation settings', () => {
      const manifestWithoutPresentation = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  identifier="TEST-MANIFEST" version="1.0">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithoutPresentation);

      const item = result.organizations.organizations[0].items[0];
      expect(item.presentation).toBeNull();
    });

    test('should filter invalid hideLMSUI values', () => {
      const manifestWithInvalidValues = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
                  identifier="TEST-MANIFEST" version="1.0">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
                <adlnav:presentation>
                  <adlnav:navigationInterface>
                    <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>invalid-value</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
                  </adlnav:navigationInterface>
                </adlnav:presentation>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithInvalidValues);

      const item = result.organizations.organizations[0].items[0];
      expect(item.presentation.navigationInterface.hideLMSUI).toEqual(['previous', 'continue']);
      expect(item.presentation.navigationInterface.hideLMSUI).not.toContain('invalid-value');
    });

    test('should handle all valid hideLMSUI values', () => {
      const manifestWithAllValues = `<?xml version="1.0" encoding="UTF-8"?>
        <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
                  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
                  identifier="TEST-MANIFEST" version="1.0">
          <organizations default="ORG-1">
            <organization identifier="ORG-1">
              <title>Test Organization</title>
              <item identifier="ITEM-1" identifierref="RES-1">
                <title>Test Item</title>
                <adlnav:presentation>
                  <adlnav:navigationInterface>
                    <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>exit</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>abandon</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>suspendAll</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>exitAll</adlnav:hideLMSUI>
                    <adlnav:hideLMSUI>abandonAll</adlnav:hideLMSUI>
                  </adlnav:navigationInterface>
                </adlnav:presentation>
              </item>
            </organization>
          </organizations>
          <resources>
            <resource identifier="RES-1" type="webcontent" href="index.html">
              <file href="index.html"/>
            </resource>
          </resources>
        </manifest>`;

      const result = manifestParser.parseManifestXML(manifestWithAllValues);

      const item = result.organizations.organizations[0].items[0];
      expect(item.presentation.navigationInterface.hideLMSUI).toEqual([
        'continue', 'previous', 'exit', 'abandon', 'suspendAll', 'exitAll', 'abandonAll'
      ]);
    });
  });
});