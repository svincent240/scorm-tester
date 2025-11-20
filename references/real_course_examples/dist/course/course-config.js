// course-config.js — Centralized course configuration for SCORM template
// Single source of truth: all metadata, structure, objectives, and feature configuration

/**
 * SCHEMA REFERENCE (for AI agents authoring courses)
 * 
 * SCORING (null = disabled):
 *   { type: 'average'|'weighted'|'maximum'|'custom', sources: [...], calculate?: fn }
 * 
 * OBJECTIVES (auto-managed by criteria OR manual via assessment.assessmentObjective):
 *   { id: 'obj-X', description: 'text', criteria: {type, ...fields}, initialCompletion: 'incomplete'|'completed', initialSuccess: 'unknown'|'passed'|'failed' }
 *   Criteria types: slideVisited|allSlidesVisited|timeOnSlide|flag|allFlags
 * 
 * ENGAGEMENT (required: false = no tracking):
 *   requirements: [{ type: viewAllTabs|viewAllPanels|interactionComplete|allInteractionsComplete|scrollDepth|timeOnSlide|flag|allFlags, message?: str, ...props }]
 *   Engagement requirement properties: interactionId (for interactionComplete), percentage (scrollDepth), minSeconds (timeOnSlide), key|flags (flag/allFlags), equals (flag matching)
 * 
 * NAVIGATION.GATING.CONDITIONS:
 *   objectiveStatus: {objectiveId, completion_status?|success_status?} | assessmentStatus: {assessmentId, requires: 'passed'|'failed'} | timeOnSlide: {slideId, minSeconds} | flag: {key, equals?} | custom: {key, equals?}
 * 
 * SLIDE: { type: 'slide', id, component, title, menu, engagement, navigation }
 * ASSESSMENT: { type: 'assessment', id, component, menu, engagement, navigation } + assessmentObjective in component
 * SECTION: { type: 'section', id, menu, children: [] }
 * 
 * navigation.controls: { showPrevious: bool, showNext: bool, exitTarget?: slideId }
 * navigation.sequence: { includeByDefault: bool, includeWhen: condition?, insert: {position: 'before'|'after', slideId} }
 * menu: { label: str, icon?: emoji, hidden?: bool, defaultExpanded?: bool }
 */

export const courseConfig = {
    // Course Metadata
    metadata: {
        title: "SCORM Template",
        description: "Advanced SCORM template for course development",
        version: "2.0.0",
        author: "Seth Vincent",
        language: "en"
    },

    // Branding Configuration
    branding: {
        logo: "./course/assets/logo.png",
        logoAlt: "Logo",
        companyName: "SV",
        courseTitle: "SCORM Template",
    },

    // Course-Level Scoring (OPTIONAL, null = disabled)
    // Configures how cmi.score.raw is calculated
    // Examples: { type: 'average', sources: ['assessment:final-exam', 'assessment:midterm'] }
    //           { type: 'weighted', sources: [{id: 'assessment:final-exam', weight: 0.7}, {id: 'assessment:midterm', weight: 0.3}] }
    //           { type: 'maximum', sources: ['assessment:attempt-1', 'assessment:attempt-2'] }
    //           { type: 'custom', sources: [...], calculate: (scores) => scores['exam'] * 0.8 + scores['labs'] * 0.2 }
    scoring: null,

    // Learning Objectives
    // Types: slideVisited (one slide), allSlidesVisited (multiple), timeOnSlide (min duration), flag (custom flag), allFlags (multiple flags)
    // Auto-linked by assessments via component's assessmentObjective property, or manually managed via criteria
    objectives: [
        {
            id: 'visited-intro',
            description: 'Visit the introduction slide',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown',
            criteria: {
                type: 'slideVisited',
                slideId: 'intro'
            }
        },
        {
            id: 'core-content',
            description: 'Visit all core content slides',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown',
            criteria: {
                type: 'allSlidesVisited',
                slideIds: ['content', 'ui-demo']
            }
        },
        {
            id: 'thorough-review',
            description: 'Spend at least 2 minutes reviewing content',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown',
            criteria: {
                type: 'timeOnSlide',
                slideId: 'content',
                minSeconds: 120
            }
        },
        {
            id: 'custom-mastery',
            description: 'Demonstrate mastery (custom logic)',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown'
            // No criteria - managed manually by course author in slide code
        },
        {
            id: 'intro-completed-flag',
            description: 'Complete introduction (flag-based)',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown',
            criteria: {
                type: 'flag',
                key: 'intro-complete',
                equals: true
            }
        },
        {
            id: 'all-sections-unlocked',
            description: 'Unlock all course sections',
            initialCompletion: 'incomplete',
            initialSuccess: 'unknown',
            criteria: {
                type: 'allFlags',
                flags: [
                    'section-1-unlocked',
                    'section-2-unlocked',
                    { key: 'section-3-unlocked', equals: true }
                ]
            }
        }
    ],

    // Course Structure (tree of sections, slides, assessments)
    // See schema reference at top of file
    structure: [
        {
            type: 'slide',
            id: 'intro',
            component: '@slides/intro.js',
            title: 'Introduction',
            menu: { label: 'Introduction', icon: '📚' },
            engagement: {
                required: false
            },
            navigation: {
                sequential: true,
                controls: { showPrevious: false, showNext: true, exitTarget: null }
            }
        },
        {
            type: 'section',
            id: 'course-content',
            menu: { label: 'Course Content', icon: '📂', defaultExpanded: true },
            children: [
                {
                    type: 'slide',
                    id: 'ui-demo',
                    component: '@slides/ui-demo.js',
                    title: 'UI Components Demo',
                    menu: { label: 'UI Components Demo', icon: '🎨' },
                    engagement: {
                        required: false
                    },
                    navigation: {
                        sequential: true,
                        controls: { showPrevious: true, showNext: true }
                    }
                },
                {
                    type: 'slide',
                    id: 'content',
                    component: '@slides/content.js',
                    title: 'Learning Content',
                    menu: { label: 'Main Content', icon: '🔧' },
                    engagement: {
                        required: true,
                        mode: 'all',
                        requirements: [
                            { type: 'viewAllTabs' },
                            { type: 'interactionComplete', interactionId: 'system-architecture-dd' },
                            { type: 'interactionComplete', interactionId: 'requirements-spec-fillin' },
                            { type: 'interactionComplete', interactionId: 'efficiency-calculation' }
                        ],
                        showIndicator: true  // Show circular progress indicator in footer
                    },
                    navigation: {
                        sequential: true,
                        controls: { showPrevious: true, showNext: true }
                    }
                }
            ]
        },
        {
            type: 'assessment',
            id: 'assessment',
            component: '@slides/assessment.js',
            title: 'Final Assessment',
            menu: { label: 'Final Exam', icon: '📝' },
            engagement: {
                required: false  // Assessments typically manage their own completion
            },
            navigation: {
                sequential: true,
                controls: { showPrevious: true, showNext: true },
                gating: {
                    mode: 'all',
                    message: 'Complete the required content before starting the exam.',
                    conditions: [
                        { type: 'objectiveStatus', objectiveId: 'core-content', completion_status: 'completed' }
                    ]
                }
            }
        },
        {
            type: 'slide',
            id: 'remedial',
            component: '@slides/remedial.js',
            title: 'Remedial Content',
            menu: { hidden: true },
            engagement: {
                required: false
            },
            navigation: {
                sequential: true,
                controls: { showPrevious: true, showNext: true, exitTarget: 'assessment' },
                gating: {
                    mode: 'any',
                    message: 'Remedial content becomes available after an unsuccessful assessment attempt.',
                    conditions: [
                        { type: 'assessmentStatus', assessmentId: 'final-exam', requires: 'failed' }
                    ]
                },
                sequence: {
                    includeByDefault: false,
                    includeWhen: { type: 'assessmentStatus', assessmentId: 'final-exam', requires: 'failed' },
                    insert: { position: 'after', slideId: 'assessment' }
                }
            }
        },
        {
            type: 'slide',
            id: 'summary',
            component: '@slides/summary.js',
            title: 'Course Summary',
            menu: { label: 'Summary', icon: '🏆' },
            engagement: {
                required: false
            },
            navigation: {
                sequential: true,
                controls: { showPrevious: true, showNext: false },
                gating: {
                    mode: 'all',
                    message: 'Summary is locked until you pass the assessment.',
                    conditions: [
                        { type: 'assessmentStatus', assessmentId: 'final-exam', requires: 'passed' }
                    ]
                }
            }
        }
    ],

    // Navigation Configuration
    navigation: {
        sidebar: {
            enabled: true,
            position: 'left',       // 'left' or 'right'
            width: '280px',
            collapsible: true,
            defaultCollapsed: true,
            showProgress: true      // Show completion checkmarks next to slides
        }
    },

    // Feature Flags
    features: {
        accessibility: {
            darkMode: true,
            fontSize: true,
            highContrast: true,
            reducedMotion: true,
            keyboardShortcuts: true
        },
        security: false,   // Secure assessment mode
        offline: false,    // Offline mode
        analytics: true,   // Learning analytics
        feedback: true     // Adaptive feedback system
    },

    // Completion behavior
    completion: {
        promptForComments: true,
        promptForRating: true
    },

    // Slide Layout Defaults
    // Auto-wraps slide content with content-width classes for consistent text constraints
    // Values: 'narrow' (700px), 'medium' (900px), 'wide' (1200px), 'full' (no constraint)
    // Can be overridden per-slide using data-content-width attribute
    slideDefaults: {
        contentWidth: 'full'
    },

    // Environment Configuration
    // TEMPLATE USERS: Configure environment-specific settings here
    environment: {
        // Initial window size recommendation for LMS desktop launch (mobile/responsive layouts ignore)
        window: { width: 1024, height: 768 },
        
        // Disable browser's beforeunload confirmation. false = show confirm on F5/close (production), true = no warning (dev)
        disableBeforeUnloadGuard: true,

        // Development Mode (import.meta.env.MODE !== 'production')
        development: {
            disableGating: true  // Bypass all navigation gating to jump to any slide (auto-disabled in production)
        },

        // Automation API Configuration (dev/testing only, requires import.meta.env.MODE !== 'production' AND automation.enabled === true)
        automation: {
            enabled: true,                    // Master switch for SCORMAutomation API (window.SCORMAutomation)
            disableBeforeUnloadGuard: true,   // Allow seamless reloads during automated testing
            exposeCorrectAnswers: true        // Expose correct answers via getCorrectResponse() for AI validation
        }
    }
};
