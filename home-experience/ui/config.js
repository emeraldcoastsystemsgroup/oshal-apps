/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract the approved Home layout while preserving the established shared renderer and member ownership.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Follow the owned attention panel with Schedule, Recent Work and Applications in the default Home column.
 */
window.HOMEBASE_PRESETS = {
  "family": {
    "id": "family",
    "skin": "family",
    "name": "Home",
    "short": "homebase",
    "mark": "h",
    "eyebrow": "HOME",
    "title": "Today",
    "subtitle": "Schedule, lists and household updates.",
    "nav": [
      [
        "home",
        "Our home"
      ],
      [
        "calendar",
        "Calendar"
      ],
      [
        "shopping",
        "Shopping list"
      ],
      [
        "people",
        "Our people"
      ],
      [
        "personal",
        "Just for me"
      ],
      [
        "routines",
        "Routines"
      ]
    ],
    "tabs": [
      [
        "home",
        "Room"
      ],
      [
        "tasks",
        "Tasks"
      ],
      [
        "files",
        "Files"
      ]
    ],
    "suites": [
      "ai-home",
      "ai-creative",
      "ai-knowledge",
      "ai-finance"
    ],
    "featured": [
      "home",
      "little-monsters",
      "purchasing",
      "games"
    ],
    "peopleKicker": "HOUSEHOLD",
    "appsHeading": "Applications",
    "updatesHeading": "Household updates",
    "calendarHeading": "Today's Schedule",
    "assistantPrompt": "Ask about your schedule, lists or household.",
    "assistantLabel": "Your home assistant",
    "sidebarNote": [
      "Access and sharing",
      "Your calendar and list are shared where an application shares them. Your money and schoolwork stay in their own spaces."
    ],
    "hosts": [
      {
        "app": "home",
        "kicker": "SMART HOME",
        "surfaces": [
          "home-dashboard"
        ]
      },
      {
        "app": "purchasing",
        "kicker": "SHOPPING",
        "surfaces": [
          "shop-concierge",
          "shop-browse",
          "shop-lists",
          "shop-deals"
        ]
      },
      {
        "app": "finance",
        "kicker": "MONEY",
        "surfaces": [
          "finance-home"
        ]
      },
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
          "lm-files"
        ]
      },
      {
        "app": "movies",
        "kicker": "WATCH",
        "surfaces": [
          "movies-concierge"
        ]
      },
      {
        "app": "spotify",
        "kicker": "LISTEN",
        "surfaces": [
          "spotify-concierge"
        ]
      },
      {
        "app": "travel",
        "kicker": "GO",
        "surfaces": [
          "travel-concierge"
        ]
      },
      {
        "app": "presentations",
        "kicker": "OFFICE",
        "surfaces": [
          "presentations-studio"
        ]
      }
    ],
    "audience": "family",
    "shoppingHeading": "Shopping List",
    "modules": {
      "main": [
        "calendar",
        "projects",
        "apps",
        "room",
        "personal",
        "locations",
        "home-facts"
      ],
      "aside": [
        "shopping",
        {
          "card": "presentations",
          "title": "Recent documents",
          "kicker": "OFFICE",
          "action": {
            "label": "Open AI Office",
            "tool": "tool-presentations-studio"
          }
        },
        "family-admin",
        "updates"
      ]
    }
  }
};
