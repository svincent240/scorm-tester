import * as AssessmentManager from '../../framework/js/managers/assessment-manager.js';

// Standardized named export for assessment configuration.
// This object is imported by the framework during initialization.
export const config = {
  // CORE IDENTITY
  id: 'final-exam', // Unique SCORM-safe assessment key
  title: '🎯 Engineering Competency Assessment', // Learner-facing heading
  containerId: 'assessment-container', // DOM node id for rendering

  // ASSESSMENT BEHAVIOR & CONSTRAINTS
  settings: {
    passingScore: 50, // Minimum percentage required to pass
    allowReview: true, // Allow review screen before submission
    showProgress: true, // Display progress bar with question count
    allowRetake: true, // Permit retake flow when learner fails
    randomizeQuestions: false, // Shuffle question order (works with questions array OR questionBanks)
    randomizeOnRetake: true, // Re-randomize on retake (default: true). Set false to keep same questions/order across attempts
    attemptsBeforeRemedial: 1, // After 1 failures, present remedial content (null = disabled)
    attemptsBeforeRestart: 2,  // After 2 failures, require course restart (null = disabled, must be > attemptsBeforeRemedial)
    remedialSlideIds: ['remedial'] // Slide IDs to navigate to for remedial review (required when attemptsBeforeRemedial is set)
  },

  // QUESTION SOURCING (optional - use questionBanks OR questions array in render(), not both)
  // Uncomment to enable randomized selection from multiple question banks:
  // questionBanks: [
  //   {
  //     id: 'safety-fundamentals',
  //     questions: [/* 20 safety questions */],
  //     selectCount: 5  // Select 5 random questions from this bank
  //   },
  //   {
  //     id: 'technical-procedures',
  //     questions: [/* 30 technical questions */],
  //     selectCount: 10  // Select 10 random questions from this bank
  //   }
  // ],
  // Note: When using questionBanks, questions are selected on first start and persist through refresh.
  // With randomizeOnRetake: true, new selection occurs on each retake.
  // With randomizeQuestions: true, selected questions are shuffled together.

  // LEARNER EXPERIENCE
  review: {
    requireAllAnswered: false // Permit submission with unanswered questions
  },

  // RESULTS
  resultsDisplay: {
    detailLevel: 'detailed', // Render full question-by-question breakdown
    showScore: true, // Display numeric score summary
    showPassFail: true, // Indicate pass or fail status
    showTimeSpent: true, // Show total time spent on assessment
    showQuestions: true, // List each question in results view
    showCorrectAnswers: true, // Reveal correct answers when learner is right
    showIncorrectAnswers: true, // Reveal correct answers when learner is wrong
    showUserResponses: true, // Display learner responses for each question
    showCorrectness: true // Tag questions as correct or incorrect
  },

  // COMPLETION & PROGRESSION LOGIC
  completionRequirements: {
    requireSubmission: true, // Assessment must be submitted
    requirePass: true, // Assessment must be passed (score >= passingScore)
    blockNavigation: true // Block leaving slide until requirements are met
  },
};

// Standardized named export for the slide component.
export const slide = {
  assessmentId: config.id,
  render: (root, context = {}) => {
    // Defensive: ensure context is always an object (handles null/undefined cases)
    const safeContext = context || {};
    const overrides = safeContext.assessmentConfig || {};
    const containerId = overrides.containerId || config.containerId;
    const assessmentTitle = overrides.title || config.title;

    // Create container element
    const slideContainer = document.createElement('div');
    slideContainer.innerHTML = `<div id="${containerId}"></div>`;

    // Define assessment questions using InteractionTypes format
    const questions = [
      {
        type: 'multiple-choice',
        id: 'advanced-engineering-quiz',
        prompt: 'Which of the following is a key principle of fault-tolerant system design?',
        weight: 1,
        choices: [
          { value: 'redundancy', text: 'Implementing redundant components and systems', correct: true },
          { value: 'cost-reduction', text: 'Minimizing system costs at all levels', correct: false },
          { value: 'single-point', text: 'Relying on a single high-quality component', correct: false },
          { value: 'complexity', text: 'Maximizing system complexity for robustness', correct: false }
        ],
        correctAnswer: 'redundancy',
        feedback: {
          correct: 'Excellent! Redundancy is essential for fault-tolerant systems.',
          incorrect: 'Review the principles of fault-tolerant design. Redundancy is key to maintaining system operation when components fail.'
        }
      },
      {
        type: 'fill-in',
        id: 'performance-specification',
        prompt: 'Complete the technical specification for a critical safety system',
        weight: 1,
        blanks: [
          { label: 'The system shall achieve', correct: 'a', placeholder: 'uptime requirement' },
          { label: 'Response time must not exceed', correct: 'a', placeholder: 'time limit' },
          { label: 'The system must support', correct: 'a', placeholder: 'user capacity' }
        ],
        caseSensitive: false,
        feedback: {
          correct: 'Excellent specification! These requirements ensure system reliability.',
          incorrect: 'Review industry standards for critical system specifications.'
        }
      }
    ];

    const assessment = AssessmentManager.createAssessment(
      { ...config, questions },
      overrides
    );

    const container = slideContainer.querySelector(`#${containerId}`);
    assessment.render(container, safeContext);

    return slideContainer;
  }
};
