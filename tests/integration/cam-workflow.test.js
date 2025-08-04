/**
 * SCORM CAM Integration Tests
 * 
 * End-to-end integration tests for the Content Aggregation Model workflow:
 * - Complete package processing
 * - Manifest parsing with real SCORM packages
 * - Content validation workflows
 * - Metadata extraction and analysis
 * - Package structure analysis
 * 
 * @fileoverview CAM integration tests
 */

const { ScormCAMService } = require('../../src/main/services/scorm/cam');
const fs = require('fs').promises;
const path = require('path');

describe('CAM Integration Workflow', () => {
  let camService;
  let mockErrorHandler;
  let testPackagePath;
  let testManifestPath;

  beforeAll(async () => {
    // Setup test package directory
    testPackagePath = path.join(__dirname, '../fixtures/test-scorm-package');
    testManifestPath = path.join(testPackagePath, 'imsmanifest.xml');
    
    await setupTestPackage();
  });

  beforeEach(() => {
    mockErrorHandler = {
      setError: jest.fn(),
      getLastError: jest.fn(() => '0'),
      getErrorString: jest.fn(() => ''),
      getDiagnostic: jest.fn(() => ''),
      clearError: jest.fn(),
      validateSessionState: jest.fn(() => true),
      setSessionState: jest.fn(),
      getSessionState: jest.fn(() => 'not_initialized'),
      hasError: jest.fn(() => false),
      getErrorHistory: jest.fn(() => []),
      getErrorState: jest.fn(() => ({
        lastError: '0',
        lastErrorString: '',
        lastDiagnostic: '',
        sessionState: 'not_initialized',
        hasError: false,
        errorCategory: 'success'
      })),
      reset: jest.fn()
    };

    camService = new ScormCAMService(mockErrorHandler);
  });

  afterAll(async () => {
    await cleanupTestPackage();
  });

  describe('Complete Package Processing', () => {
    test('should process valid SCORM package successfully', async () => {
      const result = await camService.processPackage(testPackagePath);

      // Verify complete processing result structure
      expect(result).toBeDefined();
      expect(result.manifest).toBeDefined();
      expect(result.validation).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.packagePath).toBe(testPackagePath);
      expect(result.processedAt).toBeDefined();

      // Verify manifest parsing
      expect(result.manifest.identifier).toBe('TEST-PACKAGE-001');
      expect(result.manifest.version).toBe('1.0');
      expect(result.manifest.organizations).toBeDefined();
      expect(result.manifest.resources).toBeDefined();

      // Verify validation results
      expect(result.validation.isValid).toBe(true);
      expect(result.validation.errors).toHaveLength(0);
      expect(result.validation.summary).toBeDefined();

      // Verify analysis results
      expect(result.analysis.packageInfo).toBeDefined();
      expect(result.analysis.structure).toBeDefined();
      expect(result.analysis.resources).toBeDefined();
      expect(result.analysis.statistics).toBeDefined();

      // Verify metadata extraction
      expect(result.metadata.schema).toBe('ADL SCORM');
      expect(result.metadata.schemaversion).toBe('2004 4th Edition');
    });

    test('should handle package with validation errors', async () => {
      // Create package with missing files
      const invalidPackagePath = path.join(__dirname, '../fixtures/invalid-scorm-package');
      await setupInvalidTestPackage(invalidPackagePath);

      try {
        const result = await camService.processPackage(invalidPackagePath);

        expect(result.validation.isValid).toBe(false);
        expect(result.validation.errors.length).toBeGreaterThan(0);
        expect(result.validation.errors).toContainEqual(
          expect.stringContaining('File not found')
        );
      } finally {
        await cleanupTestPackage(invalidPackagePath);
      }
    });

    test('should handle package without metadata', async () => {
      const noMetadataPackagePath = path.join(__dirname, '../fixtures/no-metadata-package');
      await setupNoMetadataPackage(noMetadataPackagePath);

      try {
        const result = await camService.processPackage(noMetadataPackagePath);

        expect(result.manifest).toBeDefined();
        expect(result.metadata).toBeNull();
        expect(result.validation.warnings).toContainEqual(
          expect.stringContaining('metadata')
        );
      } finally {
        await cleanupTestPackage(noMetadataPackagePath);
      }
    });
  });

  describe('Individual Service Operations', () => {
    test('should parse manifest independently', async () => {
      const manifest = await camService.parseManifest(testManifestPath);

      expect(manifest).toBeDefined();
      expect(manifest.identifier).toBe('TEST-PACKAGE-001');
      expect(manifest.organizations.organizations).toHaveLength(1);
      expect(manifest.resources).toHaveLength(3);
    });

    test('should validate package independently', async () => {
      const manifest = await camService.parseManifest(testManifestPath);
      const validation = await camService.validatePackage(testPackagePath, manifest);

      expect(validation).toBeDefined();
      expect(validation.isValid).toBe(true);
      expect(validation.summary.isCompliant).toBe(true);
    });

    test('should analyze package independently', async () => {
      const manifest = await camService.parseManifest(testManifestPath);
      const analysis = camService.analyzePackage(testPackagePath, manifest);

      expect(analysis).toBeDefined();
      expect(analysis.packageInfo.identifier).toBe('TEST-PACKAGE-001');
      expect(analysis.structure.organizationCount).toBe(1);
      expect(analysis.resources.totalResources).toBe(3);
      expect(analysis.statistics.scoCount).toBe(2);
      expect(analysis.statistics.assetCount).toBe(1);
    });
  });

  describe('Service Status and Capabilities', () => {
    test('should return service status', () => {
      const status = camService.getStatus();

      expect(status).toBeDefined();
      expect(status.version).toBe('1.0.0');
      expect(status.capabilities.manifestParsing).toBe(true);
      expect(status.capabilities.contentValidation).toBe(true);
      expect(status.capabilities.metadataExtraction).toBe(true);
      expect(status.capabilities.packageAnalysis).toBe(true);
      expect(status.supportedVersions).toContain('SCORM 2004 4th Edition');
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle non-existent package directory', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent-package');

      await expect(camService.processPackage(nonExistentPath))
        .rejects.toThrow();
      expect(mockErrorHandler.setError).toHaveBeenCalled();
    });

    test('should handle corrupted manifest file', async () => {
      const corruptedPackagePath = path.join(__dirname, '../fixtures/corrupted-package');
      await fs.mkdir(corruptedPackagePath, { recursive: true });
      await fs.writeFile(
        path.join(corruptedPackagePath, 'imsmanifest.xml'),
        '<manifest><corrupted></manifest>',
        'utf8'
      );

      try {
        await expect(camService.processPackage(corruptedPackagePath))
          .rejects.toThrow();
        expect(mockErrorHandler.setError).toHaveBeenCalled();
      } finally {
        await cleanupTestPackage(corruptedPackagePath);
      }
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large package efficiently', async () => {
      const startTime = Date.now();
      const result = await camService.processPackage(testPackagePath);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should handle multiple concurrent processing requests', async () => {
      const promises = Array(5).fill().map(() => 
        camService.processPackage(testPackagePath)
      );

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.manifest.identifier).toBe('TEST-PACKAGE-001');
      });
    });
  });

  // Helper functions for test setup
  async function setupTestPackage() {
    await fs.mkdir(testPackagePath, { recursive: true });
    
    // Create test manifest
    const testManifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
          identifier="TEST-PACKAGE-001" version="1.0">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-001">
    <organization identifier="ORG-001">
      <title>Test Course</title>
      <item identifier="ITEM-001" identifierref="RES-001">
        <title>Lesson 1</title>
      </item>
      <item identifier="ITEM-002" identifierref="RES-002">
        <title>Lesson 2</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-001" type="webcontent" adlcp:scormType="sco" href="lesson1.html">
      <file href="lesson1.html"/>
      <file href="common.js"/>
      <dependency identifierref="RES-003"/>
    </resource>
    <resource identifier="RES-002" type="webcontent" adlcp:scormType="sco" href="lesson2.html">
      <file href="lesson2.html"/>
      <file href="common.js"/>
      <dependency identifierref="RES-003"/>
    </resource>
    <resource identifier="RES-003" type="webcontent" adlcp:scormType="asset">
      <file href="common.js"/>
      <file href="styles.css"/>
    </resource>
  </resources>
</manifest>`;

    await fs.writeFile(testManifestPath, testManifest, 'utf8');

    // Create referenced files
    await fs.writeFile(path.join(testPackagePath, 'lesson1.html'), '<html><body>Lesson 1</body></html>', 'utf8');
    await fs.writeFile(path.join(testPackagePath, 'lesson2.html'), '<html><body>Lesson 2</body></html>', 'utf8');
    await fs.writeFile(path.join(testPackagePath, 'common.js'), '// Common JavaScript', 'utf8');
    await fs.writeFile(path.join(testPackagePath, 'styles.css'), '/* Common styles */', 'utf8');
  }

  async function setupInvalidTestPackage(packagePath) {
    await fs.mkdir(packagePath, { recursive: true });
    
    const invalidManifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          identifier="INVALID-PACKAGE" version="1.0">
  <organizations default="ORG-001">
    <organization identifier="ORG-001">
      <title>Invalid Course</title>
      <item identifier="ITEM-001" identifierref="RES-001">
        <title>Missing File Lesson</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-001" type="webcontent" adlcp:scormType="sco" href="missing.html">
      <file href="missing.html"/>
      <file href="also-missing.js"/>
    </resource>
  </resources>
</manifest>`;

    await fs.writeFile(path.join(packagePath, 'imsmanifest.xml'), invalidManifest, 'utf8');
    // Intentionally not creating the referenced files
  }

  async function setupNoMetadataPackage(packagePath) {
    await fs.mkdir(packagePath, { recursive: true });
    
    const noMetadataManifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          identifier="NO-METADATA-PACKAGE" version="1.0">
  <organizations default="ORG-001">
    <organization identifier="ORG-001">
      <title>No Metadata Course</title>
      <item identifier="ITEM-001" identifierref="RES-001">
        <title>Simple Lesson</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-001" type="webcontent" href="simple.html">
      <file href="simple.html"/>
    </resource>
  </resources>
</manifest>`;

    await fs.writeFile(path.join(packagePath, 'imsmanifest.xml'), noMetadataManifest, 'utf8');
    await fs.writeFile(path.join(packagePath, 'simple.html'), '<html><body>Simple</body></html>', 'utf8');
  }

  async function cleanupTestPackage(packagePath = testPackagePath) {
    try {
      await fs.rm(packagePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
});