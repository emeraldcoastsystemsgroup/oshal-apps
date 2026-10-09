/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Own the established display configuration; current catalogs and permissions stay with their owners.
 */
window.HOMEBASE_PRESETS = {
  "classroom": {
    "id": "classroom",
    "skin": "classroom",
    "name": "Classroom",
    "short": "classroom",
    "mark": "m",
    "eyebrow": "CLASSROOM",
    "title": "Classwork",
    "subtitle": "Assignments, class schedule and learning progress.",
    "nav": [
      [
        "home",
        "Our classroom"
      ],
      [
        "requirements",
        "Classwork"
      ],
      [
        "calendar",
        "Class calendar"
      ],
      [
        "personal",
        "My learning"
      ],
      [
        "people",
        "Class community"
      ]
    ],
    "suites": [
      "ai-home",
      "ai-knowledge",
      "ai-creative"
    ],
    "featured": [
      "little-monsters",
      "games"
    ],
    "peopleKicker": "CLASS COMMUNITY",
    "appsHeading": "Applications",
    "updatesHeading": "Class updates",
    "calendarHeading": "Today's Schedule",
    "assistantPrompt": "Ask about your classwork or study materials.",
    "assistantLabel": "Study assistant",
    "sidebarNote": [
      "Access and sharing",
      "Classwork is shared with your class. Your personal learning stays in your space."
    ],
    "hosts": [
      {
        "app": "little-monsters",
        "kicker": "LITTLE MONSTERS",
        "surfaces": [
          "lm-dashboard",
          "lm-myday",
          "lm-tutor",
          "lm-flashcards",
          "lm-arcade",
          "lm-monsters",
          "lm-recorder",
          "lm-presentations",
          "lm-timelines",
          "lm-formula-lab",
          "lm-stem",
          "lm-citations",
          "lm-files",
          "lm-teacher",
          "lm-voice-settings"
        ]
      },
      {
        "app": "presentations",
        "kicker": "MAKE AND SHARE",
        "surfaces": [
          "presentations-studio"
        ]
      },
      {
        "app": "circuit-lab",
        "kicker": "BUILD AND TEST",
        "surfaces": [
          "circuit-lab"
        ]
      }
    ],
    "audience": "classroom",
    "modules": {
      "main": [
        "requirements",
        {
          "teacher": "roster",
          "otherwise": "calendar"
        },
        "apps"
      ],
      "aside": [
        {
          "teacher": "calendar",
          "otherwise": "personal"
        },
        "updates"
      ]
    }
  }
};
