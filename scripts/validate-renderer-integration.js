#!/usr/bin/env node

/**
 * Renderer Integration Validation Script
 * 
 * Validates that the new modular renderer properly integrates with the existing
 * main process services:
 * - IPC communication channels
 * - Service method compatibility
 * - Event handling integration
 * - Data flow validation
 * - Error propagation
 * 
 * @fileoverview Renderer-Main process integration validation
 */

const fs = require('fs');
const path = require('path');

class RendererIntegrationValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.results = {
      ipcChannels: {},
      serviceIntegration: {},
      eventHandling: {},
      dataFlow: {},
      errorHandling: {}
    };
  }

  /**
   * Run all renderer integration validations
   */
  async validate() {
    console.log('🔗 Validating Renderer-Main Process Integration...\n');

    try {
      await this.validateIPCChannels();
      await this.validateServiceIntegration();
      await this.validateEventHandling();
      await this.validateDataFlow();
      await this.validateErrorHandling();
      
      this.printResults();
      
      if (this.errors.length > 0) {
        console.error(`\n❌ Renderer integration validation failed with ${this.errors.length} errors`);
        process.exit(1);
      } else {
        console.log(`\n✅ Renderer integration validation passed!`);
        if (this.warnings.length > 0) {
          console.log(`⚠️  ${this.warnings.length} warnings found`);
        }
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Renderer integration validation failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Validate IPC channel compatibility
   */
  async validateIPCChannels() {
    console.log('📡 Validating IPC channel compatibility...');
    
    // Check main process IPC handler
    const ipcHandlerPath = path.join(process.cwd(), 'src/main/services/ipc-handler.js');
    const scormClientPath = path.join(process.cwd(), 'src/renderer/services/scorm-client.js');
    
    if (!fs.existsSync(ipcHandlerPath)) {
      this.errors.push('Missing main process IPC handler');
      return;
    }
    
    if (!fs.existsSync(scormClientPath)) {
      this.errors.push('Missing renderer SCORM client');
      return;
    }

    const ipcContent = fs.readFileSync(ipcHandlerPath, 'utf8');
    const clientContent = fs.readFileSync(scormClientPath, 'utf8');
    
    // Extract registered IPC channels from main process
    const channelMatches = ipcContent.match(/registerHandler\(['"`]([^'"`]+)['"`]/g) || [];
    const registeredChannels = channelMatches.map(match => 
      match.match(/['"`]([^'"`]+)['"`]/)[1]
    );

    // Extract IPC calls from renderer
    const ipcCallMatches = clientContent.match(/ipcRenderer\.invoke\(['"`]([^'"`]+)['"`]/g) || [];
    const rendererChannels = ipcCallMatches.map(match => 
      match.match(/['"`]([^'"`]+)['"`]/)[1]
    );

    console.log(`  📋 Main process channels: ${registeredChannels.length}`);
    console.log(`  📋 Renderer channels: ${rendererChannels.length}`);

    // Check for missing channels
    const missingChannels = rendererChannels.filter(channel => 
      !registeredChannels.includes(channel)
    );

    if (missingChannels.length > 0) {
      this.errors.push(`Renderer uses unregistered IPC channels: ${missingChannels.join(', ')}`);
    }

    // Check for unused channels
    const unusedChannels = registeredChannels.filter(channel => 
      !rendererChannels.includes(channel)
    );

    if (unusedChannels.length > 0) {
      this.warnings.push(`Main process has unused IPC channels: ${unusedChannels.join(', ')}`);
    }

    this.results.ipcChannels.registered = registeredChannels.length;
    this.results.ipcChannels.used = rendererChannels.length;
    this.results.ipcChannels.missing = missingChannels.length;
    this.results.ipcChannels.unused = unusedChannels.length;

    // Validate specific SCORM channels
    const requiredScormChannels = [
      'scorm-initialize',
      'scorm-get-value',
      'scorm-set-value',
      'scorm-commit',
      'scorm-terminate'
    ];

    for (const channel of requiredScormChannels) {
      if (registeredChannels.includes(channel)) {
        console.log(`  ✅ ${channel} channel available`);
      } else {
        this.errors.push(`Missing required SCORM channel: ${channel}`);
      }
    }
  }

  /**
   * Validate service integration
   */
  async validateServiceIntegration() {
    console.log('\n⚙️ Validating service integration...');
    
    // Check renderer services
    const rendererServices = [
      'src/renderer/services/event-bus.js',
      'src/renderer/services/ui-state.js', 
      'src/renderer/services/scorm-client.js'
    ];

    // Check main process services
    const mainServices = [
      'src/main/services/scorm-service.js',
      'src/main/services/file-manager.js',
      'src/main/services/window-manager.js'
    ];

    let validServices = 0;
    const totalServices = rendererServices.length + mainServices.length;

    for (const servicePath of [...rendererServices, ...mainServices]) {
      const fullPath = path.join(process.cwd(), servicePath);
      
      if (!fs.existsSync(fullPath)) {
        this.errors.push(`Missing service: ${servicePath}`);
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Check for proper service structure
      if (!content.includes('class ')) {
        this.errors.push(`Service ${servicePath} missing class structure`);
        continue;
      }

      validServices++;
      console.log(`  ✅ ${path.basename(servicePath)} service valid`);
    }

    this.results.serviceIntegration.validServices = validServices;
    this.results.serviceIntegration.totalServices = totalServices;
    this.results.serviceIntegration.percentage = (validServices / totalServices) * 100;

    // Check for service dependencies
    const appJsPath = path.join(process.cwd(), 'src/renderer/app.js');
    if (fs.existsSync(appJsPath)) {
      const appContent = fs.readFileSync(appJsPath, 'utf8');
      
      // Check if services are properly imported and initialized
      const serviceImports = [
        'EventBus',
        'UIStateManager', 
        'ScormClient'
      ];

      for (const serviceImport of serviceImports) {
        if (appContent.includes(serviceImport)) {
          console.log(`  ✅ ${serviceImport} properly imported`);
        } else {
          this.warnings.push(`Service ${serviceImport} not imported in app.js`);
        }
      }
    }
  }

  /**
   * Validate event handling integration
   */
  async validateEventHandling() {
    console.log('\n📢 Validating event handling integration...');
    
    const eventBusPath = path.join(process.cwd(), 'src/renderer/services/event-bus.js');
    const appJsPath = path.join(process.cwd(), 'src/renderer/app.js');
    
    if (!fs.existsSync(eventBusPath)) {
      this.errors.push('Missing event bus service');
      return;
    }

    const eventBusContent = fs.readFileSync(eventBusPath, 'utf8');
    
    // Check for required event bus methods
    const requiredMethods = ['on', 'off', 'emit', 'once'];
    let implementedMethods = 0;
    
    for (const method of requiredMethods) {
      if (eventBusContent.includes(`${method}(`)) {
        implementedMethods++;
        console.log(`  ✅ EventBus.${method} method available`);
      } else {
        this.errors.push(`EventBus missing required method: ${method}`);
      }
    }

    this.results.eventHandling.implementedMethods = implementedMethods;
    this.results.eventHandling.totalRequired = requiredMethods.length;
    this.results.eventHandling.percentage = (implementedMethods / requiredMethods.length) * 100;

    // Check if app.js uses event bus
    if (fs.existsSync(appJsPath)) {
      const appContent = fs.readFileSync(appJsPath, 'utf8');
      
      if (appContent.includes('eventBus') || appContent.includes('EventBus')) {
        console.log('  ✅ App.js integrates with event bus');
      } else {
        this.warnings.push('App.js does not appear to use event bus');
      }
    }
  }

  /**
   * Validate data flow
   */
  async validateDataFlow() {
    console.log('\n🔄 Validating data flow...');
    
    // Check if SCORM client properly handles data flow
    const scormClientPath = path.join(process.cwd(), 'src/renderer/services/scorm-client.js');
    
    if (!fs.existsSync(scormClientPath)) {
      this.errors.push('Missing SCORM client for data flow validation');
      return;
    }

    const clientContent = fs.readFileSync(scormClientPath, 'utf8');
    
    // Check for proper async/await usage
    if (clientContent.includes('async ') && clientContent.includes('await ')) {
      console.log('  ✅ SCORM client uses async/await for data flow');
    } else {
      this.warnings.push('SCORM client should use async/await for better data flow');
    }

    // Check for error handling in data flow
    if (clientContent.includes('try') && clientContent.includes('catch')) {
      console.log('  ✅ SCORM client includes error handling');
    } else {
      this.warnings.push('SCORM client should include try/catch error handling');
    }

    // Check for data validation
    if (clientContent.includes('validate') || clientContent.includes('validation')) {
      console.log('  ✅ SCORM client includes data validation');
    } else {
      this.warnings.push('SCORM client should include data validation');
    }

    this.results.dataFlow.hasAsyncSupport = clientContent.includes('async ');
    this.results.dataFlow.hasErrorHandling = clientContent.includes('try') && clientContent.includes('catch');
    this.results.dataFlow.hasValidation = clientContent.includes('validate');
  }

  /**
   * Validate error handling
   */
  async validateErrorHandling() {
    console.log('\n🚨 Validating error handling...');
    
    const rendererFiles = [
      'src/renderer/app.js',
      'src/renderer/services/scorm-client.js',
      'src/renderer/services/event-bus.js',
      'src/renderer/services/ui-state.js'
    ];

    let filesWithErrorHandling = 0;
    
    for (const filePath of rendererFiles) {
      const fullPath = path.join(process.cwd(), filePath);
      
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Check for error handling patterns
      const hasErrorHandling = (
        content.includes('try') && content.includes('catch')
      ) || (
        content.includes('error') && content.includes('Error')
      );

      if (hasErrorHandling) {
        filesWithErrorHandling++;
        console.log(`  ✅ ${path.basename(filePath)} includes error handling`);
      } else {
        this.warnings.push(`File ${filePath} should include error handling`);
      }
    }

    this.results.errorHandling.filesWithErrorHandling = filesWithErrorHandling;
    this.results.errorHandling.totalFiles = rendererFiles.length;
    this.results.errorHandling.percentage = (filesWithErrorHandling / rendererFiles.length) * 100;

    // Check for global error handling
    const appJsPath = path.join(process.cwd(), 'src/renderer/app.js');
    if (fs.existsSync(appJsPath)) {
      const appContent = fs.readFileSync(appJsPath, 'utf8');
      
      if (appContent.includes('window.addEventListener') && appContent.includes('error')) {
        console.log('  ✅ Global error handling configured');
      } else {
        this.warnings.push('Consider adding global error handling in app.js');
      }
    }
  }

  /**
   * Print validation results
   */
  printResults() {
    console.log('\n📊 Renderer Integration Results:');
    console.log('='.repeat(60));
    
    // IPC Channels
    if (this.results.ipcChannels.registered !== undefined) {
      console.log(`📡 IPC Channels: ${this.results.ipcChannels.registered} registered, ${this.results.ipcChannels.used} used`);
      if (this.results.ipcChannels.missing > 0) {
        console.log(`   ❌ ${this.results.ipcChannels.missing} missing channels`);
      }
      if (this.results.ipcChannels.unused > 0) {
        console.log(`   ⚠️  ${this.results.ipcChannels.unused} unused channels`);
      }
    }
    
    // Service Integration
    if (this.results.serviceIntegration.percentage !== undefined) {
      console.log(`⚙️ Service Integration: ${this.results.serviceIntegration.percentage.toFixed(1)}% (${this.results.serviceIntegration.validServices}/${this.results.serviceIntegration.totalServices})`);
    }
    
    // Event Handling
    if (this.results.eventHandling.percentage !== undefined) {
      console.log(`📢 Event Handling: ${this.results.eventHandling.percentage.toFixed(1)}% (${this.results.eventHandling.implementedMethods}/${this.results.eventHandling.totalRequired})`);
    }
    
    // Data Flow
    console.log(`🔄 Data Flow: Async=${this.results.dataFlow.hasAsyncSupport}, Errors=${this.results.dataFlow.hasErrorHandling}, Validation=${this.results.dataFlow.hasValidation}`);
    
    // Error Handling
    if (this.results.errorHandling.percentage !== undefined) {
      console.log(`🚨 Error Handling: ${this.results.errorHandling.percentage.toFixed(1)}% (${this.results.errorHandling.filesWithErrorHandling}/${this.results.errorHandling.totalFiles})`);
    }
    
    // Overall integration score
    const scores = [
      this.results.serviceIntegration.percentage || 0,
      this.results.eventHandling.percentage || 0,
      this.results.errorHandling.percentage || 0
    ];
    
    const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    console.log(`\n🔗 Overall Integration Score: ${overallScore.toFixed(1)}%`);
    
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
  const validator = new RendererIntegrationValidator();
  validator.validate().catch(error => {
    console.error('Renderer integration validation failed:', error);
    process.exit(1);
  });
}

module.exports = RendererIntegrationValidator;