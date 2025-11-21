import { createDragDropQuestion } from '../../framework/js/components/interactions/drag-drop.js';
import { createFillInQuestion } from '../../framework/js/components/interactions/fill-in.js';
import { createNumericQuestion } from '../../framework/js/components/interactions/numeric.js';

export const slide = {
  render: (root) => {
    const slideContainer = document.createElement('div');
    slideContainer.innerHTML = `
      <div class="content-wide stack-lg">
        
        <div class="stack-sm">
          <h1>🔧 Engineering Problem-Solving Workshop!!!</h1>
          <p class="font-size-lg">Apply your knowledge in these interactive scenarios.</p>
        </div>

        <div class="tabs" id="workshop-tabs" data-component="tabs">
          <div class="tab-list" role="tablist">
            <button class="tab-button active" data-action="select-tab" data-tab="dragdrop-content" role="tab" aria-selected="true" aria-controls="dragdrop-content">
              🏗️ System Architecture
            </button>
            <button class="tab-button" data-action="select-tab" data-tab="fillin-content" role="tab" aria-selected="false" aria-controls="fillin-content">
              📋 Requirements Analysis
            </button>
            <button class="tab-button" data-action="select-tab" data-tab="numeric-content" role="tab" aria-selected="false" aria-controls="numeric-content">
              📊 Performance Metrics
            </button>
          </div>

          <div id="dragdrop-content" class="tab-content active" role="tabpanel">
            <div class="card no-hover stack-md">
              <div>
                <h2 class="text-xl font-bold">System Architecture Design</h2>
                <p>Design a robust engineering system by organizing components into their proper architectural layers:</p>
              </div>
              <div id="dragdrop-interaction"></div>
            </div>
          </div>

          <div id="fillin-content" class="tab-content" role="tabpanel" hidden>
            <div class="card no-hover stack-md">
              <div>
                <h2 class="text-xl font-bold">Requirements Analysis & Specification</h2>
                <p>Complete the engineering requirements specification for a critical system component:</p>
              </div>
              <div id="fillin-interaction"></div>
            </div>
          </div>

          <div id="numeric-content" class="tab-content" role="tabpanel" hidden>
            <div class="card no-hover stack-md">
              <div>
                <h2 class="text-xl font-bold">Performance Metrics & Calculations</h2>
                <p>Calculate key performance indicators for system optimization:</p>
              </div>
              <div id="numeric-interaction"></div>
            </div>
          </div>
        </div>

      </div>
    `;

    setupInteractions(slideContainer);
    return slideContainer;
  }
};

function setupInteractions(slideContainer) {
  // Drag and drop interaction setup
  try {
    const dragContainer = slideContainer.querySelector('#dragdrop-interaction');
    if (dragContainer) {
      const dragDropConfig = {
        id: 'system-architecture-dd',
        prompt: 'Organize these engineering components into their proper system architecture layers',
        items: [
          { id: 'user-interface', content: 'User Interface Layer' },
          { id: 'business-logic', content: 'Business Logic Layer' },
          { id: 'data-access', content: 'Data Access Layer' },
          { id: 'infrastructure', content: 'Infrastructure Services' },
          { id: 'security', content: 'Security Framework' }
        ],
        dropZones: [
          { id: 'presentation', label: 'Presentation Layer', accepts: ['user-interface'], maxItems: 1 },
          { id: 'application', label: 'Application Layer', accepts: ['business-logic', 'security'], maxItems: 2 },
          { id: 'data', label: 'Data Layer', accepts: ['data-access', 'infrastructure'], maxItems: 2 }
        ]
      };
      const dragDropQuestion = createDragDropQuestion(dragDropConfig);
      dragDropQuestion.render(dragContainer);
    }
  } catch (e) {
    console.warn('Drag-drop interaction setup failed:', e);
  }

  // Fill-in interaction setup
  try {
    const fillContainer = slideContainer.querySelector('#fillin-interaction');
    if (fillContainer) {
      const fillInConfig = {
        id: 'requirements-spec-fillin',
        prompt: 'Complete the engineering requirements specification for a critical system component',
        blanks: [
          { label: 'The system shall maintain', correct: 'operational integrity', placeholder: 'operational ___' },
          { label: 'Performance requirements must meet', correct: 'industry standards', placeholder: 'industry ___' },
          { label: 'Safety protocols require', correct: 'redundant systems', placeholder: 'redundant ___' }
        ]
      };
      const fillInQuestion = createFillInQuestion(fillInConfig);
      fillInQuestion.render(fillContainer);
    }
  } catch (e) {
    console.warn('Fill-in interaction setup failed:', e);
  }

  // Numeric interaction setup
  try {
    const numericContainer = slideContainer.querySelector('#numeric-interaction');
    if (numericContainer) {
      const numericConfig = {
        id: 'efficiency-calculation',
        prompt: 'A system processes 1500 transactions per minute with 98.5% accuracy. What is the error rate?',
        correctRange: { exact: 1.5 },
        tolerance: 0.1,
        units: '%'
      };
      const numericQuestion = createNumericQuestion(numericConfig);
      numericQuestion.render(numericContainer);
    }
  } catch (e) {
    console.warn('Numeric interaction setup failed:', e);
  }
}
