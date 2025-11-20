import * as FeedbackSystem from '../../framework/js/utilities/feedback-system.js';
import interactionManager from '../../framework/js/managers/interaction-manager.js';
import * as AppActions from '../../framework/js/app/AppActions.js';

export const slide = {
  render: (root) => {
    const slideContainer = document.createElement('div');
    const interactions = interactionManager.getAllInteractions();
    const sessionDurationMs = AppActions.getSessionDuration();
    const learningData = FeedbackSystem.getLearningAnalytics(interactions, sessionDurationMs);
    const sessionDurationMinutes = Math.floor(sessionDurationMs / 60000);
    const sessionDurationDisplay = sessionDurationMinutes > 0
      ? `${sessionDurationMinutes} minutes`
      : 'Less than a minute';

    slideContainer.innerHTML = `
      <div class="content-medium stack-lg">
        
        <h1>🏆 Professional Development Complete</h1>

        <div class="callout callout-success">
          <h2 class="text-xl font-bold">🎉 Excellence Achieved!</h2>
          <p>You have successfully completed the advanced engineering professional development program.
             Your demonstrated expertise in modern engineering practices and problem-solving will contribute
             significantly to our team's success and innovation initiatives.</p>
        </div>

        <section class="card no-hover">
          <h2 class="text-lg font-bold border-bottom pb-2 mb-4">📊 Your Engineering Development Journey</h2>
          <div class="cols-2 gap-4">
            <div class="p-4 bg-gray-50 rounded text-center">
              <h3 class="text-sm font-bold text-muted uppercase">Development Time</h3>
              <p class="text-xl font-bold text-primary">${sessionDurationDisplay}</p>
            </div>
            <div class="p-4 bg-gray-50 rounded text-center">
              <h3 class="text-sm font-bold text-muted uppercase">Technical Challenges</h3>
              <p class="text-xl font-bold text-primary">${learningData.interactions.length} completed</p>
            </div>
            <div class="p-4 bg-gray-50 rounded text-center">
              <h3 class="text-sm font-bold text-muted uppercase">Performance Rating</h3>
              <p class="text-xl font-bold text-primary">${Math.round((learningData.interactions.reduce((sum, i) => sum + (i.score || 0), 0) / Math.max(1, learningData.interactions.length)) * 100)}%</p>
            </div>
            <div class="p-4 bg-gray-50 rounded text-center">
              <h3 class="text-sm font-bold text-muted uppercase">Problem-Solving Style</h3>
              <p class="text-xl font-bold text-primary">${learningData.patterns.learningStyle || 'Analytical'}</p>
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-xl font-bold mb-4">🚀 Professional Skills Demonstrated</h2>
          <div class="cols-2 gap-4">
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>System Architecture:</strong> Complex system design and component integration</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Requirements Analysis:</strong> Technical specification development and validation</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Performance Optimization:</strong> Metrics analysis and system performance enhancement</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Quality Assurance:</strong> Comprehensive testing and validation procedures</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Professional Standards:</strong> Industry best practices and compliance requirements</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Technical Communication:</strong> Clear documentation and stakeholder communication</div>
            </div>
            <div class="d-flex gap-2 items-start">
              <span class="text-success">✅</span>
              <div><strong>Innovation:</strong> Creative problem-solving and solution development</div>
            </div>
          </div>
        </section>

        <section class="card no-hover bg-gray-50">
          <h2 class="text-lg font-bold mb-4">🎯 Career Development Opportunities</h2>
          <p class="mb-4">Based on your demonstrated competencies, consider these professional development paths:</p>
          <ul class="list-styled stack-sm">
            <li><strong>Senior Engineer Track:</strong> Advanced technical leadership and project management</li>
            <li><strong>Technical Specialist:</strong> Deep expertise in specific engineering domains</li>
            <li><strong>Innovation Lead:</strong> Research and development of cutting-edge solutions</li>
            <li><strong>Mentorship Program:</strong> Knowledge transfer and team development</li>
            <li><strong>Certification Preparation:</strong> Professional engineering certifications</li>
          </ul>
        </section>

        <div class="d-flex justify-center gap-4 mt-4">
          <button class="btn btn-primary" data-action="generate-report">
            📊 Generate Achievement Report
          </button>
          <button class="btn btn-secondary" data-action="provide-feedback">
            💭 Share Your Experience
          </button>
        </div>

        <div id="final-report" aria-live="polite"></div>
      </div>
    `;
    return slideContainer;
  }
};