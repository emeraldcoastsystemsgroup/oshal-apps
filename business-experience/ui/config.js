/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Own the established display configuration; current catalogs and permissions stay with their owners.
 */
window.HOMEBASE_PRESETS = {
  "company": {
    "id": "company",
    "skin": "company",
    "name": "Business",
    "short": "workspace",
    "mark": "w",
    "eyebrow": "BUSINESS",
    "title": "Today",
    "subtitle": "Schedule, projects and recent work.",
    "nav": [
      [
        "home",
        "Overview"
      ],
      [
        "projects",
        "Projects"
      ],
      [
        "calendar",
        "Team calendar"
      ],
      [
        "people",
        "People & specialists"
      ],
      [
        "personal",
        "My workspace"
      ]
    ],
    "suites": [
      "ai-productivity",
      "ai-engineering",
      "ai-finance",
      "ai-knowledge"
    ],
    "featured": [
      "presentations",
      "cad-studio",
      "marketing-suite",
      "finance"
    ],
    "peopleKicker": "TEAM",
    "appsHeading": "Applications",
    "updatesHeading": "Team updates",
    "calendarHeading": "Team Schedule",
    "assistantPrompt": "Ask about your schedule, projects or documents.",
    "assistantLabel": "Work assistant",
    "sidebarNote": [
      "Access and sharing",
      "Team work stays shared. Personal conversations and restricted applications stay scoped to you."
    ],
    "hosts": [
      {
        "app": "presentations",
        "kicker": "PRESENTATIONS",
        "surfaces": [
          "presentations-studio"
        ]
      },
      {
        "app": "email-summarizer",
        "kicker": "OFFICE · EMAIL",
        "surfaces": [
          "email-myday"
        ]
      },
      {
        "app": "calendar",
        "kicker": "OFFICE · CALENDAR",
        "surfaces": [
          "calendar-review"
        ]
      },
      {
        "app": "world",
        "kicker": "OFFICE · WORLD BRIEFING",
        "surfaces": [
          "world-dashboard"
        ]
      },
      {
        "app": "finance",
        "kicker": "FINANCE",
        "surfaces": [
          "finance-home"
        ]
      },
      {
        "app": "switchboard",
        "kicker": "COMMUNICATIONS",
        "surfaces": [
          "switchboard-today",
          "switchboard-inbox",
          "switchboard-threads",
          "switchboard-calendar",
          "switchboard-compose",
          "switchboard-stage",
          "switchboard-streams",
          "switchboard-feeds",
          "switchboard-workspaces"
        ]
      },
      {
        "app": "social",
        "kicker": "COMMUNICATIONS · SOCIAL",
        "surfaces": [
          "social-composer"
        ]
      },
      {
        "app": "calling-assistant",
        "kicker": "COMMUNICATIONS · CALLS",
        "surfaces": [
          "calling-settings"
        ]
      },
      {
        "app": "marketing-engine",
        "kicker": "GROWTH · MARKETING",
        "surfaces": [
          "marketing-engine"
        ]
      },
      {
        "app": "venture-plan",
        "kicker": "GROWTH · VENTURES",
        "surfaces": [
          "venture-home"
        ]
      },
      {
        "app": "private-app-1",
        "kicker": "CRM · FEDERAL",
        "surfaces": [
          "federal-home"
        ]
      },
      {
        "app": "payroll",
        "kicker": "PAYROLL",
        "surfaces": [
          "payroll-home"
        ]
      },
      {
        "app": "payments",
        "kicker": "PAYMENTS",
        "surfaces": [
          "payments-home"
        ]
      },
      {
        "app": "identity",
        "kicker": "IDENTITY",
        "surfaces": [
          "identity-home"
        ]
      },
      {
        "app": "cad-studio",
        "kicker": "ENGINEERING",
        "surfaces": [
          "cad-studio"
        ]
      }
    ],
    "audience": "company",
    "shoppingHeading": "Your lists",
    "modules": {
      "main": [
        {
          "card": "email-summarizer",
          "title": "Today",
          "kicker": "OFFICE · EMAIL",
          "action": {
            "label": "Open My Day",
            "tool": "tool-email-myday"
          }
        },
        {
          "card": "calendar",
          "title": "Office calendar",
          "kicker": "OFFICE · CALENDAR",
          "action": {
            "label": "Open Calendar",
            "tool": "tool-calendar-review"
          }
        },
        {
          "card": "presentations",
          "title": "Recent documents",
          "kicker": "OFFICE · DOCUMENTS",
          "action": {
            "label": "Open AI Office",
            "tool": "tool-presentations-studio"
          }
        },
        {
          "card": "private-app-1",
          "title": "Capture pipeline",
          "kicker": "CRM · FEDERAL",
          "action": {
            "label": "Open Federal CRM",
            "tool": "tool-federal-home"
          }
        },
        "projects",
        "apps"
      ],
      "aside": [
        {
          "card": "payroll",
          "title": "Payroll",
          "kicker": "PAYROLL",
          "action": {
            "label": "Open Payroll",
            "tool": "tool-payroll-home"
          }
        },
        {
          "card": "calling-assistant",
          "title": "Calls",
          "kicker": "COMMUNICATIONS · CALLS",
          "action": {
            "label": "Open Calling",
            "tool": "tool-calling-settings"
          }
        },
        "shopping",
        "personal",
        "updates"
      ]
    }
  }
};
