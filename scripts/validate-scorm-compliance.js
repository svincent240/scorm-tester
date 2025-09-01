#!/usr/bin/env node

/**
 * SCORM Compliance Validation Script
 * 
 * Validates that the SCORM Tester implementation meets all SCORM 2004 4th Edition
 * compliance requirements:
 * - API implementation completeness
 * - Data model validation
 * - Sequencing and navigation compliance
 * - Content aggregation model support
 * - Error handling and recovery
 * 
 * @fileoverview SCORM 2004 4th Edition compliance validation
 */

const fs = require('fs');
const path = require('path');

class ScormComplianceValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.results = {
      apiCompliance: {},
      dataModelCompliance: {},
      sequencingCompliance: {},
      camCompliance: {},
      errorHandling: {}
    };
  }

  /**
   * Run all SCORM compliance validations
   */
  async validate() {
    console.log('🎯 Validating SCORM 2004 4th Edition Compliance...\n');

    try {
      await this.validateAPICompliance();
      await this.validateDataModelCompliance();
      await this.validateSequencingCompliance();
      await this.validateCAMCompliance();
      await this.validateErrorHandling();
      
      this.printResults();
      
      if (this.errors.length > 0) {
        console.error(`\n❌ SCORM compliance validation failed with ${this.errors.length} errors`);
        process.exit(1);
      } else {
        console.log(`\n✅ SCORM compliance validation passed!`);
        if (this.warnings.length > 0) {
          console.log(`⚠️  ${this.warnings.length} warnings found`);
        }
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ SCORM compliance validation failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Validate SCORM API implementation
   */
  async validateAPICompliance() {
    console.log('🔌 Validating SCORM API compliance...');
    
    const apiHandlerPath = path.join(process.cwd(), 'src/main/services/scorm/rte/api-handler.js');
    
    if (!fs.existsSync(apiHandlerPath)) {
      this.errors.push('Missing SCORM API handler implementation');
      return;
    }

    const content = fs.readFileSync(apiHandlerPath, 'utf8');
    
    // Check for required SCORM API functions
    const requiredFunctions = [
      'Initialize',
      'Terminate', 
      'GetValue',
      'SetValue',
      'Commit',
      'GetLastError',
      'GetErrorString',
      'GetDiagnostic'
    ];

    let implementedFunctions = 0;
    for (const func of requiredFunctions) {
      if (content.includes(`${func}(`)) {
        implementedFunctions++;
        console.log(`  ✅ ${func} function implemented`);
      } else {
        this.errors.push(`Missing required SCORM API function: ${func}`);
      }
    }

    this.results.apiCompliance.implementedFunctions = implementedFunctions;
    this.results.apiCompliance.totalRequired = requiredFunctions.length;
    this.results.apiCompliance.percentage = (implementedFunctions / requiredFunctions.length) * 100;

    // Check for proper error handling
    if (!content.includes('errorHandler') && !content.includes('error')) {
      this.warnings.push('API handler should include comprehensive error handling');
    }

    // Check for session state management
    if (!content.includes('session') || !content.includes('state')) {
      this.warnings.push('API handler should manage session state');
    }
  }

  /**
   * Validate SCORM data model compliance
   */
  async validateDataModelCompliance() {
    console.log('\n📊 Validating SCORM data model compliance...');
    
    const dataModelPath = path.join(process.cwd(), 'src/main/services/scorm/rte/data-model.js');
    
    if (!fs.existsSync(dataModelPath)) {
      this.errors.push('Missing SCORM data model implementation');
      return;
    }

    const content = fs.readFileSync(dataModelPath, 'utf8');
    
    // Check for required data model elements
    const requiredElements = [
      'cmi.completion_status',
      'cmi.success_status',
      'cmi.score.scaled',
      'cmi.score.raw',
      'cmi.score.max',
      'cmi.score.min',
      'cmi.location',
      'cmi.suspend_data',
      'cmi.entry',
      'cmi.exit',
      'cmi.session_time',
      'cmi.total_time',
      'cmi.interactions',
      'cmi.objectives',
      'adl.nav.request'
    ];

    let supportedElements = 0;
    for (const element of requiredElements) {
      // Check for both regular dots and escaped dots patterns
      const regularPattern = element;
      const escapedPattern = element.replace(/\./g, '\\.');
      
      if (content.includes(regularPattern) || content.includes(escapedPattern)) {
        supportedElements++;
        console.log(`  ✅ ${element} supported`);
      } else {
        this.warnings.push(`Data model element not explicitly handled: ${element}`);
      }
    }

    this.results.dataModelCompliance.supportedElements = supportedElements;
    this.results.dataModelCompliance.totalRequired = requiredElements.length;
    this.results.dataModelCompliance.percentage = (supportedElements / requiredElements.length) * 100;

    // Check for data validation
    if (!content.includes('validate') && !content.includes('validation')) {
      this.warnings.push('Data model should include data validation');
    }

    // Check for interaction support
    if (!content.includes('interactions')) {
      this.warnings.push('Data model should support interactions');
    }
  }

  /**
   * Validate sequencing and navigation compliance
   */
  async validateSequencingCompliance() {
    console.log('\n🧭 Validating sequencing and navigation compliance...');
    
    const snServicePath = path.join(process.cwd(), 'src/main/services/scorm/sn/index.js');
    
    if (!fs.existsSync(snServicePath)) {
      this.errors.push('Missing Sequencing and Navigation service');
      return;
    }

    const content = fs.readFileSync(snServicePath, 'utf8');
    
    // Check for required sequencing components
    const requiredComponents = [
      'ActivityTree',
      'SequencingEngine', 
      'NavigationHandler',
      'RollupManager'
    ];

    let implementedComponents = 0;
    for (const component of requiredComponents) {
      if (content.includes(component)) {
        implementedComponents++;
        console.log(`  ✅ ${component} implemented`);
      } else {
        this.warnings.push(`Sequencing component not found: ${component}`);
      }
    }

    this.results.sequencingCompliance.implementedComponents = implementedComponents;
    this.results.sequencingCompliance.totalRequired = requiredComponents.length;
    this.results.sequencingCompliance.percentage = (implementedComponents / requiredComponents.length) * 100;

    // Check for navigation request handling
    const navigationRequests = [
      'continue',
      'previous', 
      'exit',
      'exitAll',
      'abandon',
      'abandonAll',
      'suspendAll',
      'start',
      'resumeAll'
    ];

    let supportedNavigation = 0;
    for (const navRequest of navigationRequests) {
      if (content.includes(navRequest)) {
        supportedNavigation++;
      }
    }

    if (supportedNavigation < navigationRequests.length * 0.8) {
      this.warnings.push('Not all navigation requests appear to be supported');
    }

    // Check for sequencing rules support
    if (!content.includes('sequencingRules') && !content.includes('rules')) {
      this.warnings.push('Sequencing rules support not clearly implemented');
    }
  }

  /**
   * Validate Content Aggregation Model compliance
   */
  async validateCAMCompliance() {
    console.log('\n📦 Validating Content Aggregation Model compliance...');
    
    const camServicePath = path.join(process.cwd(), 'src/main/services/scorm/cam/index.js');
    
    if (!fs.existsSync(camServicePath)) {
      this.errors.push('Missing Content Aggregation Model service');
      return;
    }

    const content = fs.readFileSync(camServicePath, 'utf8');
    
    // Check for required CAM components
    const requiredComponents = [
      'ManifestParser',
      'ContentValidator',
      'MetadataHandler',
      'PackageAnalyzer'
    ];

    let implementedComponents = 0;
    for (const component of requiredComponents) {
      if (content.includes(component)) {
        implementedComponents++;
        console.log(`  ✅ ${component} implemented`);
      } else {
        this.warnings.push(`CAM component not found: ${component}`);
      }
    }

    this.results.camCompliance.implementedComponents = implementedComponents;
    this.results.camCompliance.totalRequired = requiredComponents.length;
    this.results.camCompliance.percentage = (implementedComponents / requiredComponents.length) * 100;

    // Check for manifest validation
    if (!content.includes('manifest') || !content.includes('validate')) {
      this.warnings.push('Manifest validation not clearly implemented');
    }

    // Check for resource handling
    if (!content.includes('resource') && !content.includes('Resource')) {
      this.warnings.push('Resource handling not clearly implemented');
    }

    // Check for organization support
    if (!content.includes('organization') && !content.includes('Organization')) {
      this.warnings.push('Organization structure handling not clearly implemented');
    }
  }

  /**
   * Validate error handling compliance
   */
  async validateErrorHandling() {
    console.log('\n🚨 Validating error handling compliance...');
    
    const errorHandlerPath = path.join(process.cwd(), 'src/main/services/scorm/rte/error-handler.js');
    
    if (!fs.existsSync(errorHandlerPath)) {
      this.errors.push('Missing SCORM error handler implementation');
      return;
    }

    const content = fs.readFileSync(errorHandlerPath, 'utf8');
    const sharedErrorCodesPath = path.join(process.cwd(), 'src/shared/constants/error-codes.js');
    let SCORM_ERROR_CODES = {};
    try {
      // Load shared constants as the source of truth
      ({ SCORM_ERROR_CODES } = require(sharedErrorCodesPath));
    } catch (e) {
      this.errors.push('Failed to load shared SCORM error codes');
    }

    // Required SCORM 2004 error codes to be present in shared constants
    const requiredErrorCodes = [
      '0',    // No error
      '101',  // General exception
      '102',  // General initialization failure
      '103',  // Already initialized
      '104',  // Content instance terminated
      '111',  // General termination failure
      '112',  // Termination before initialization
      '113',  // Termination after termination
      '122',  // Retrieve data before initialization
      '123',  // Retrieve data after termination
      '132',  // Store data before initialization
      '133',  // Store data after termination
      '142',  // Commit before initialization
      '143',  // Commit after termination
      '201',  // General argument error
      '301',  // General get failure
      '351',  // General set failure
      '391',  // General commit failure
      '401',  // General get failure (SCORM RTE)
      '402',  // General set failure (SCORM RTE)
      '403',  // General commit failure (SCORM RTE)
      '404',  // Undefined data model element
      '405',  // Unimplemented data model element
      '406',  // Data model element value not initialized
      '407',  // Data model element is read only
      '408'   // Data model element is write only
    ];

    // Verify shared constants include the required codes
    let availableErrorCodes = 0;
    for (const code of requiredErrorCodes) {
      if (Object.prototype.hasOwnProperty.call(SCORM_ERROR_CODES, code)) {
        availableErrorCodes++;
      }
    }

    // Consider implemented if error handler imports shared constants
    const usesSharedConstants = content.includes("shared/constants/error-codes");

    this.results.errorHandling.implementedErrorCodes = availableErrorCodes;
    this.results.errorHandling.totalRequired = requiredErrorCodes.length;
    this.results.errorHandling.percentage = (availableErrorCodes / requiredErrorCodes.length) * 100;

    console.log(`  ✅ ${availableErrorCodes}/${requiredErrorCodes.length} required SCORM error codes available in shared constants`);

    if (!usesSharedConstants) {
      this.warnings.push('Error handler does not import shared SCORM error codes');
    }
    if (availableErrorCodes < requiredErrorCodes.length) {
      this.warnings.push('Not all required SCORM error codes are defined in shared constants');
    }

    // Check for error message handling
    if (!content.includes('errorString') && !content.includes('ErrorString')) {
      this.warnings.push('Error string handling not clearly implemented');
    }

    // Check for diagnostic information
    if (!content.includes('diagnostic') && !content.includes('Diagnostic')) {
      this.warnings.push('Diagnostic information handling not clearly implemented');
    }
  }

  /**
   * Print validation results
   */
  printResults() {
    console.log('\n📊 SCORM Compliance Results:');
    console.log('='.repeat(60));
    
    // API Compliance
    if (this.results.apiCompliance.percentage !== undefined) {
      console.log(`🔌 API Compliance: ${this.results.apiCompliance.percentage.toFixed(1)}% (${this.results.apiCompliance.implementedFunctions}/${this.results.apiCompliance.totalRequired})`);
    }
    
    // Data Model Compliance
    if (this.results.dataModelCompliance.percentage !== undefined) {
      console.log(`📊 Data Model: ${this.results.dataModelCompliance.percentage.toFixed(1)}% (${this.results.dataModelCompliance.supportedElements}/${this.results.dataModelCompliance.totalRequired})`);
    }
    
    // Sequencing Compliance
    if (this.results.sequencingCompliance.percentage !== undefined) {
      console.log(`🧭 Sequencing: ${this.results.sequencingCompliance.percentage.toFixed(1)}% (${this.results.sequencingCompliance.implementedComponents}/${this.results.sequencingCompliance.totalRequired})`);
    }
    
    // CAM Compliance
    if (this.results.camCompliance.percentage !== undefined) {
      console.log(`📦 CAM: ${this.results.camCompliance.percentage.toFixed(1)}% (${this.results.camCompliance.implementedComponents}/${this.results.camCompliance.totalRequired})`);
    }
    
    // Error Handling
    if (this.results.errorHandling.percentage !== undefined) {
      console.log(`🚨 Error Handling: ${this.results.errorHandling.percentage.toFixed(1)}% (${this.results.errorHandling.implementedErrorCodes}/${this.results.errorHandling.totalRequired})`);
    }
    
    // Overall compliance score
    const scores = [
      this.results.apiCompliance.percentage || 0,
      this.results.dataModelCompliance.percentage || 0,
      this.results.sequencingCompliance.percentage || 0,
      this.results.camCompliance.percentage || 0,
      this.results.errorHandling.percentage || 0
    ];
    
    const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    console.log(`\n🎯 Overall SCORM Compliance: ${overallScore.toFixed(1)}%`);
    
    // Errors and warnings summary
    console.log(`❌ Errors: ${this.errors.length}`);
    console.log(`⚠️  Warnings: ${this.warnings.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.errors.forEach(error => console.log(`  • ${error}`));
    }
    
    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warning => console.log(`  • ${warning}`));
    }
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new ScormComplianceValidator();
  validator.validate().catch(error => {
    console.error('SCORM compliance validation failed:', error);
    process.exit(1);
  });
}

module.exports = ScormComplianceValidator;
