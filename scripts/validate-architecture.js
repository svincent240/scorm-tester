#!/usr/bin/env node

/**
 * Architecture Validation Script
 * 
 * Validates that the new modular renderer architecture meets all requirements:
 * - File size limits (index.html <300 lines, all other files <200 lines)
 * - Component structure and inheritance
 * - Service layer implementation
 * - TypeScript definitions completeness
 * - CSS modular architecture
 * 
 * @fileoverview Architecture validation for Phase 5+6 completion
 */

const fs = require('fs');
const path = require('path');

class ArchitectureValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.results = {
      fileSizes: {},
      componentStructure: {},
      serviceLayer: {},
      typeDefinitions: {},
      cssArchitecture: {}
    };
  }

  /**
   * Run all architecture validations
   */
  async validate() {
    console.log('🔍 Validating SCORM Tester Architecture...\n');

    try {
      await this.validateFileSizes();
      await this.validateComponentStructure();
      await this.validateServiceLayer();
      await this.validateTypeDefinitions();
      await this.validateCSSArchitecture();
      
      this.printResults();
      
      if (this.errors.length > 0) {
        console.error(`\n❌ Architecture validation failed with ${this.errors.length} errors`);
        process.exit(1);
      } else {
        console.log(`\n✅ Architecture validation passed!`);
        if (this.warnings.length > 0) {
          console.log(`⚠️  ${this.warnings.length} warnings found`);
        }
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Architecture validation failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Validate file size requirements
   */
  async validateFileSizes() {
    console.log('📏 Validating file sizes...');
    
    const filesToCheck = [
      { path: 'index.html', maxLines: 300 },
      { path: 'src/renderer/app.js', maxLines: 200 },
      { path: 'src/renderer/services/event-bus.js', maxLines: 200 },
      { path: 'src/renderer/services/ui-state.js', maxLines: 200 },
      { path: 'src/renderer/services/scorm-client.js', maxLines: 200 },
      { path: 'src/renderer/components/base-component.js', maxLines: 200 },
      { path: 'src/renderer/components/scorm/content-viewer.js', maxLines: 200 },
      { path: 'src/renderer/components/scorm/navigation-controls.js', maxLines: 200 },
      { path: 'src/renderer/components/scorm/progress-tracking.js', maxLines: 200 },
      { path: 'src/renderer/components/scorm/debug-panel.js', maxLines: 200 },
      { path: 'src/renderer/components/scorm/course-outline.js', maxLines: 200 },
      { path: 'src/shared/types/scorm-types.d.ts', maxLines: 200 },
      { path: 'src/renderer/types/component-types.d.ts', maxLines: 200 },
      { path: 'src/styles/base/variables.css', maxLines: 200 },
      { path: 'src/styles/components/buttons.css', maxLines: 200 },
      { path: 'src/styles/components/forms.css', maxLines: 200 },
      { path: 'src/styles/components/layout.css', maxLines: 200 },
      { path: 'src/styles/themes/default.css', maxLines: 200 },
      { path: 'src/styles/themes/dark.css', maxLines: 200 }
    ];

    for (const file of filesToCheck) {
      const filePath = path.join(process.cwd(), file.path);
      
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing required file: ${file.path}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const lineCount = content.split('\n').length;
      
      this.results.fileSizes[file.path] = {
        lines: lineCount,
        maxLines: file.maxLines,
        passed: lineCount <= file.maxLines
      };

      if (lineCount > file.maxLines) {
        this.errors.push(`File ${file.path} has ${lineCount} lines (max: ${file.maxLines})`);
      } else {
        console.log(`  ✅ ${file.path}: ${lineCount}/${file.maxLines} lines`);
      }
    }
  }

  /**
   * Validate component structure
   */
  async validateComponentStructure() {
    console.log('\n🧩 Validating component structure...');
    
    const requiredComponents = [
      'src/renderer/components/base-component.js',
      'src/renderer/components/scorm/content-viewer.js',
      'src/renderer/components/scorm/navigation-controls.js',
      'src/renderer/components/scorm/progress-tracking.js',
      'src/renderer/components/scorm/debug-panel.js',
      'src/renderer/components/scorm/course-outline.js'
    ];

    for (const componentPath of requiredComponents) {
      const filePath = path.join(process.cwd(), componentPath);
      
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing component: ${componentPath}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check for class structure and export
      if (!content.includes('class ') || (!content.includes('export ') && !content.includes('module.exports'))) {
        this.errors.push(`Component ${componentPath} missing class or export`);
        continue;
      }

      // Check for required methods in base component
      if (componentPath.includes('base-component')) {
        const requiredMethods = ['render', 'destroy', 'show', 'hide'];
        for (const method of requiredMethods) {
          if (!content.includes(`${method}(`)) {
            this.errors.push(`BaseComponent missing required method: ${method}`);
          }
        }
      }

      // Check for inheritance in SCORM components
      if (componentPath.includes('scorm/') && !componentPath.includes('base-component')) {
        if (!content.includes('extends ') && !content.includes('BaseComponent')) {
          this.warnings.push(`Component ${componentPath} should extend BaseComponent`);
        }
      }

      console.log(`  ✅ ${path.basename(componentPath)} structure valid`);
    }
  }

  /**
   * Validate service layer
   */
  async validateServiceLayer() {
    console.log('\n⚙️ Validating service layer...');
    
    const requiredServices = [
      'src/renderer/services/event-bus.js',
      'src/renderer/services/ui-state.js',
      'src/renderer/services/scorm-client.js'
    ];

    for (const servicePath of requiredServices) {
      const filePath = path.join(process.cwd(), servicePath);
      
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing service: ${servicePath}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check for class structure and export
      if (!content.includes('class ') || (!content.includes('export ') && !content.includes('module.exports'))) {
        this.errors.push(`Service ${servicePath} missing class or export`);
        continue;
      }

      // Service-specific validations
      const serviceName = path.basename(servicePath, '.js');
      
      if (serviceName === 'event-bus') {
        const requiredMethods = ['on', 'off', 'emit', 'once'];
        for (const method of requiredMethods) {
          if (!content.includes(`${method}(`)) {
            this.errors.push(`EventBus missing required method: ${method}`);
          }
        }
      }

      if (serviceName === 'ui-state') {
        const requiredMethods = ['getState', 'setState', 'subscribe', 'persistState'];
        for (const method of requiredMethods) {
          if (!content.includes(`${method}(`)) {
            this.errors.push(`UIStateManager missing required method: ${method}`);
          }
        }
      }

      if (serviceName === 'scorm-client') {
        const requiredMethods = ['Initialize', 'Terminate', 'GetValue', 'SetValue'];
        for (const method of requiredMethods) {
          if (!content.includes(`${method}(`)) {
            this.errors.push(`ScormClient missing required method: ${method}`);
          }
        }
      }

      console.log(`  ✅ ${serviceName} service valid`);
    }
  }

  /**
   * Validate TypeScript definitions
   */
  async validateTypeDefinitions() {
    console.log('\n📝 Validating TypeScript definitions...');
    
    const typeFiles = [
      'src/shared/types/scorm-types.d.ts',
      'src/renderer/types/component-types.d.ts'
    ];

    for (const typeFile of typeFiles) {
      const filePath = path.join(process.cwd(), typeFile);
      
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing TypeScript definitions: ${typeFile}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check for TypeScript syntax
      if (!content.includes('interface ') && !content.includes('type ')) {
        this.errors.push(`TypeScript file ${typeFile} missing interface or type definitions`);
        continue;
      }

      // Check for SCORM-specific types
      if (typeFile.includes('scorm-types')) {
        const requiredTypes = ['ScormAPI', 'ScormDataModel', 'ScormManifest'];
        for (const type of requiredTypes) {
          if (!content.includes(type)) {
            this.warnings.push(`SCORM types missing: ${type}`);
          }
        }
      }

      // Check for component-specific types
      if (typeFile.includes('component-types')) {
        const requiredTypes = ['ComponentConfig', 'BaseComponent'];
        for (const type of requiredTypes) {
          if (!content.includes(type)) {
            this.warnings.push(`Component types missing: ${type}`);
          }
        }
      }

      console.log(`  ✅ ${path.basename(typeFile)} definitions valid`);
    }
  }

  /**
   * Validate CSS architecture
   */
  async validateCSSArchitecture() {
    console.log('\n🎨 Validating CSS architecture...');
    
    const cssFiles = [
      'src/styles/main.css',
      'src/styles/base/variables.css',
      'src/styles/components/buttons.css',
      'src/styles/components/forms.css',
      'src/styles/components/layout.css',
      'src/styles/themes/default.css',
      'src/styles/themes/dark.css'
    ];

    for (const cssFile of cssFiles) {
      const filePath = path.join(process.cwd(), cssFile);
      
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing CSS file: ${cssFile}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check for CSS custom properties in variables.css
      if (cssFile.includes('variables.css')) {
        if (!content.includes('--') || !content.includes(':root')) {
          this.errors.push(`Variables.css missing CSS custom properties`);
          continue;
        }
      }

      // Check for theme-specific properties
      if (cssFile.includes('themes/')) {
        if (!content.includes('--') || !content.includes('theme-')) {
          this.warnings.push(`Theme file ${cssFile} should use CSS custom properties`);
        }
      }

      console.log(`  ✅ ${path.basename(cssFile)} structure valid`);
    }

    // Check main.css imports
    const mainCssPath = path.join(process.cwd(), 'src/styles/main.css');
    if (fs.existsSync(mainCssPath)) {
      const content = fs.readFileSync(mainCssPath, 'utf8');
      const requiredImports = ['base/', 'components/', 'themes/'];
      
      for (const importPath of requiredImports) {
        if (!content.includes(importPath)) {
          this.warnings.push(`main.css missing import for ${importPath}`);
        }
      }
    }
  }

  /**
   * Print validation results
   */
  printResults() {
    console.log('\n📊 Validation Results:');
    console.log('='.repeat(50));
    
    // File sizes summary
    const fileSizeResults = Object.values(this.results.fileSizes);
    const passedFiles = fileSizeResults.filter(r => r.passed).length;
    console.log(`📏 File Sizes: ${passedFiles}/${fileSizeResults.length} files within limits`);
    
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
  const validator = new ArchitectureValidator();
  validator.validate().catch(error => {
    console.error('Validation failed:', error);
    process.exit(1);
  });
}

module.exports = ArchitectureValidator;