"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Purpose-first starter catalog, one per artifact KIND. A Word document is a resume, a flyer, a letter or a report; a spreadsheet is a budget, a plan, a tracker or a forecast; a deck tells a story, explains, guides a meeting or sells. Served by GET /starters (the themes pattern) so the studio and the Create front door render the same catalog and nothing is copied.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Every starter carries a `prompt` — the one line the AI-draft box asks for, in the purpose's own words.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_STARTERS = exports.STARTER_KINDS = void 0;
exports.starterCatalog = starterCatalog;
exports.STARTER_KINDS = [
    { id: 'pptx', name: 'Presentation', noun: 'deck', opens: 'PowerPoint · Slides · Impress',
        groups: [{ id: 'story', label: 'Tell a story' }, { id: 'explain', label: 'Explain a topic' }, { id: 'meeting', label: 'Run a meeting' }, { id: 'sell', label: 'Market & sell' }] },
    { id: 'docx', name: 'Document', noun: 'document', opens: 'Word · Docs · Writer',
        groups: [{ id: 'career', label: 'Career' }, { id: 'marketing', label: 'Marketing' }, { id: 'writing', label: 'Business writing' }, { id: 'reports', label: 'Reports & proposals' }] },
    { id: 'xlsx', name: 'Spreadsheet', noun: 'workbook', opens: 'Excel · Sheets · Calc',
        groups: [{ id: 'money', label: 'Money' }, { id: 'plans', label: 'Plans & schedules' }, { id: 'tracking', label: 'Tracking' }, { id: 'sales', label: 'Sales & billing' }] },
];
/* Outline micro-syntax (slide-content-parser): blank line = new section; first line = its title;
   `## Name` = a named group inside a section; `| a | b |` = a table (bare numbers become real Number
   cells in Excel); `Label: 120` = a numeric series (a chart in a deck, a Label/Value sheet with a live
   SUM total in Excel); `Label :: caption` = a metric / step / timeline pair; `> text` = a quote. */
const DECKS = [
    { id: 'pitch', kind: 'pptx', group: 'story', icon: '🚀', name: 'Pitch', desc: 'Win backing for an idea — the problem, why now, the ask.', title: 'Pitch', theme: 'midnight',
        prompt: 'e.g. a seed pitch for a logistics startup that cuts empty-truck miles',
        outline: 'The problem\nwho feels it and how badly\nwhat it costs them today\n\nWhy now\nwhat changed in the market\nwhy this moment matters\n\nOur solution\nwhat it is in one line\nthe one thing it does best\n\nTraction\nTBD :: replace with a real metric\nTBD :: who is already using it\n\nThe ask\nwhat we want from this room\nthe next step' },
    { id: 'strategy', kind: 'pptx', group: 'story', icon: '🧭', name: 'Strategy review', desc: 'Where we are, what changed, the options, one recommendation.', title: 'Strategy Review', theme: 'executive',
        prompt: 'e.g. should we build our own billing or buy it — options and a recommendation',
        outline: 'Where we are\ncurrent state in 2-3 bullets\nthe key number that matters\n\nWhat changed\nthe new signal or shift\nwhy it forces a decision\n\nBuild vs buy\n## Build\nfull control of the roadmap\nour IP\nslower to ship\n## Buy\nlive next quarter\nvendor lock-in\n\nRecommendation\nwhich option and why\nwhat we are NOT doing\n\nNext steps\nowner + date\nowner + date' },
    { id: 'update', kind: 'pptx', group: 'meeting', icon: '📈', name: 'Project update', desc: 'Keep sponsors current — goal, progress, risks, decisions.', title: 'Project Update', theme: 'aurora',
        prompt: 'e.g. the September update on the warehouse rollout for the steering group',
        outline: 'Goal\nwhat done looks like\nwhy it matters\n\nWhere we are\nTBD :: percent complete\nTBD :: shipped this month\nTBD :: open risks\n\nProgress\nshipped since last update\nin flight now\n\nRisks\ntop risk + mitigation\nsecond risk + mitigation\n\nTimeline\nQ1 2026 :: Private preview\nQ2 2026 :: General availability\nQ3 2026 :: Scale' },
    { id: 'teach', kind: 'pptx', group: 'explain', icon: '🎓', name: 'Explainer', desc: 'Teach one topic — what, why, how, an example, the takeaway.', title: 'Explainer', theme: 'paper',
        prompt: 'e.g. explain retrieval-augmented generation to a business audience',
        outline: 'What it is\nplain-language definition\nwhat it is NOT\n\nWhy it matters\nthe problem it solves\nwho should care\n\nHow it works\nDiscover :: gather the inputs\nDecide :: pick the approach\nDeliver :: ship and measure\n\nExample\na concrete walkthrough\nwhat to notice\n\nThe one thing to remember\nthe single takeaway' },
    { id: 'review', kind: 'pptx', group: 'story', icon: '📊', name: 'Numbers review', desc: 'Walk a room through the quarter — headline, trend, mix, actions.', title: 'Quarterly Review', theme: 'executive',
        prompt: 'e.g. Q3 numbers review for the sales leadership team',
        outline: 'The headline\nTBD :: the one number that matters\n\nTrend\nQ1: 120\nQ2: 180\nQ3: 240\nQ4: 310\n\nRevenue mix\nEnterprise: 55\nMid-market: 30\nSelf-serve: 15\n\nBy segment\n| Segment | Revenue | Growth |\n| Enterprise | TBD | TBD |\n| Mid-market | TBD | TBD |\n\nActions\nowner + date\nowner + date' },
    { id: 'launch', kind: 'pptx', group: 'sell', icon: '🎯', name: 'Product launch', desc: 'Market a product — the customer, the pain, the proof, the offer.', title: 'Product Launch', theme: 'neon',
        prompt: 'e.g. launch deck for a smart thermostat aimed at landlords',
        outline: 'The customer\nwho they are in one line\nwhat they are trying to get done\n\nThe pain\nwhat gets in their way today\nwhat it costs them\n\nMeet the product\n> one sentence that says what it is and why it matters\n\nHow it works\nStart :: the first thing they do\nSee :: the moment it clicks\nWin :: the result they walk away with\n\nProof\nTBD :: a customer result\nTBD :: a number that backs it\n\nThe offer\nwhat it costs\nwhat they get on day one\n\nCall to action\nthe one thing to do next' },
    { id: 'meeting', kind: 'pptx', group: 'meeting', icon: '🗓️', name: 'Meeting guide', desc: 'Run a meeting that ends with decisions — agenda, choices, owners.', title: 'Meeting Guide', theme: 'monochrome',
        prompt: 'e.g. agenda for the quarterly planning meeting, three decisions to make',
        outline: 'Purpose & outcomes\nwhy we are here\nwhat we leave with\n\nAgenda\n9:00 :: Context in five minutes\n9:05 :: The decision on the table\n9:25 :: Options and trade-offs\n9:45 :: Decide and assign\n\nDecisions needed\ndecision one\ndecision two\n\nOptions\n## Option A\nwhat it gives us\nwhat it costs\n## Option B\nwhat it gives us\nwhat it costs\n\nActions & owners\n| Action | Owner | Due |\n| TBD | TBD | TBD |\n| TBD | TBD | TBD |\n\nParking lot\nthings we deliberately did not discuss' },
    { id: 'training', kind: 'pptx', group: 'explain', icon: '🧑‍🏫', name: 'Training & onboarding', desc: 'Get people doing the thing — concepts, steps, practice, recap.', title: 'Training', theme: 'aurora',
        prompt: 'e.g. onboarding for new support agents on our ticketing tool',
        outline: 'What you will learn\nthe three things you can do after this\nhow long it takes\n\nKey concepts\nconcept one in plain words\nconcept two in plain words\n\nStep by step\n1 :: set it up\n2 :: do the core task\n3 :: check the result\n\nTry it\na practice exercise\nwhat a good answer looks like\n\nCommon mistakes\nthe mistake and the fix\nthe mistake and the fix\n\nRecap & resources\nthe one thing to remember\nwhere to go for help' },
    { id: 'proposal-deck', kind: 'pptx', group: 'sell', icon: '🤝', name: 'Proposal', desc: 'Win the work — their situation, your approach, timeline, investment.', title: 'Proposal', theme: 'executive',
        prompt: 'e.g. a proposal to redesign a retailer\'s checkout in ten weeks',
        outline: 'Your situation\nwhat we heard\nwhat is at stake\n\nGoals\nthe outcome you want\nhow we will know it worked\n\nOur approach\nDiscover :: two weeks\nBuild :: six weeks\nLaunch :: two weeks\n\nTimeline\nWeek 1 :: kickoff\nWeek 4 :: first review\nWeek 10 :: go live\n\nInvestment\n| Phase | Fee |\n| Discover | TBD |\n| Build | TBD |\n| Launch | TBD |\n\nWhy us\nthe proof that we have done this before\n\nNext steps\nwhat happens when you say yes' },
];
const DOCUMENTS = [
    { id: 'resume', kind: 'docx', group: 'career', icon: '🧑‍💼', name: 'Resume', desc: 'Get the interview — summary, experience with results, skills, education.', title: 'Resume', theme: 'monochrome',
        prompt: 'e.g. a resume for a senior SAP architect moving into AI platform work',
        outline: 'Contact\nYour Name\ncity · phone · email · linkedin\n\nSummary\ntwo lines on who you are and the value you bring\nthe one thing you want them to remember\n\nExperience\n## Most recent role — Company, 2024 to present\nresult you delivered, with a number\nresult you delivered, with a number\n## Previous role — Company, 2020 to 2024\nresult you delivered, with a number\nresult you delivered, with a number\n\nSkills\ntools and methods you actually use\ncertifications\n\nEducation\ndegree — school — year' },
    { id: 'cover-letter', kind: 'docx', group: 'career', icon: '✉️', name: 'Cover letter', desc: 'Make the case for one role — why them, why you, the ask.', title: 'Cover Letter', theme: 'paper',
        prompt: 'e.g. a cover letter for a product manager role at a fintech, my background is …',
        outline: 'Opening\nDear Hiring Manager,\nthe role you are applying for and how you found it\n\nWhy them\nwhat draws you to this company or team specifically\n\nWhy you\nthe experience that maps to the role, with one result\na second proof point\n\nClosing\nwhat you would like to happen next\nSincerely, Your Name' },
    { id: 'flyer', kind: 'docx', group: 'marketing', icon: '📣', name: 'Flyer / advertisement', desc: 'Sell one thing on one page — headline, offer, proof, call to action.', title: 'Flyer', theme: 'sunrise',
        prompt: 'e.g. a flyer for a weekend pottery class, first session free',
        outline: 'Headline\n> the promise in eight words or fewer\n\nThe offer\nwhat it is\nwhat it costs, or what the deal is\nwhen it ends\n\nWhy us\nreason one\nreason two\nreason three\n\nProof\n> a short quote from a happy customer\n\nDetails\nwhere · when · how to get it\n\nCall to action\nthe one thing to do next, and how' },
    { id: 'one-pager', kind: 'docx', group: 'marketing', icon: '📃', name: 'One-pager', desc: 'Explain a product or idea on a single page for a busy reader.', title: 'One-Pager', theme: 'monochrome',
        prompt: 'e.g. a one-pager for an internal tool that automates expense approvals',
        outline: 'What it is\none sentence\n\nWho it is for\nthe person and the moment they need it\n\nWhy it wins\nreason one\nreason two\nreason three\n\nProof\nTBD :: a result\nTBD :: a result\n\nHow to get started\nstep one\nstep two\n\nContact\nname · email · link' },
    { id: 'newsletter', kind: 'docx', group: 'marketing', icon: '📰', name: 'Newsletter', desc: 'Keep a community current — lead story, updates, what is coming.', title: 'Newsletter', theme: 'sandstone',
        prompt: 'e.g. the October newsletter for a neighborhood garden club',
        outline: 'Lead story\nthe headline\nthree lines on what happened and why it matters\n\nUpdates\nupdate one\nupdate two\nupdate three\n\nSpotlight\na person, a team or a customer worth celebrating\n\nComing up\ndate :: what is happening\ndate :: what is happening\n\nGet involved\nhow to reply, join or contribute' },
    { id: 'letter', kind: 'docx', group: 'writing', icon: '📝', name: 'Business letter', desc: 'A formal letter that gets a reply — purpose, detail, request.', title: 'Letter', theme: 'paper',
        prompt: 'e.g. a letter to a supplier requesting a revised delivery schedule',
        outline: 'Header\nYour Name · Your Organisation\naddress · date\n\nRecipient\nName · Title\nOrganisation · address\n\nOpening\nDear Name,\nwhy you are writing, in one sentence\n\nDetail\nthe background they need\nthe specifics of what you propose or need\n\nRequest\nexactly what you are asking for and by when\n\nClosing\nthank you and how to reach you\nSincerely, Your Name' },
    { id: 'minutes', kind: 'docx', group: 'writing', icon: '🗒️', name: 'Meeting minutes', desc: 'Record what was decided and who does what by when.', title: 'Meeting Minutes', theme: 'paper',
        prompt: 'e.g. minutes for today\'s design review — attendees, decisions, actions',
        outline: 'Meeting\ndate · time · location\nattendees\n\nAgenda\nitem one\nitem two\n\nDiscussion\nthe main points raised, by item\n\nDecisions\ndecision one\ndecision two\n\nAction items\n| Action | Owner | Due |\n| TBD | TBD | TBD |\n| TBD | TBD | TBD |\n\nNext meeting\ndate · what we will cover' },
    { id: 'memo', kind: 'docx', group: 'writing', icon: '📌', name: 'Memo', desc: 'One decision or announcement, stated plainly for the whole team.', title: 'Memo', theme: 'monochrome',
        prompt: 'e.g. a memo announcing the new remote-work policy',
        outline: 'Memo\nTo · From · Date · Subject\n\nThe point\n> the decision or announcement in one sentence\n\nWhy\nthe reason in two or three lines\n\nWhat changes\nwhat is different from today\nwhat stays the same\n\nWhat we need from you\naction · by when\n\nQuestions\nwho to ask' },
    { id: 'report', kind: 'docx', group: 'reports', icon: '📑', name: 'Report', desc: 'Findings a decision can rest on — summary, evidence, recommendations.', title: 'Report', theme: 'executive',
        prompt: 'e.g. a findings report on why support tickets doubled in August',
        outline: 'Executive summary\nthe answer in three lines\nthe recommendation\n\nBackground\nwhy this was looked at\nwhat was in scope\n\nFindings\n## Finding one\nwhat we saw\nwhat it means\n## Finding two\nwhat we saw\nwhat it means\n\nBy the numbers\n| Measure | Before | After |\n| TBD | TBD | TBD |\n| TBD | TBD | TBD |\n\nRecommendations\nrecommendation one\nrecommendation two\n\nNext steps\nowner + date\nowner + date' },
    { id: 'proposal-doc', kind: 'docx', group: 'reports', icon: '🤝', name: 'Proposal', desc: 'Scope, approach, timeline and price for work someone is buying.', title: 'Proposal', theme: 'executive',
        prompt: 'e.g. a proposal for a three-month data-warehouse migration',
        outline: 'Overview\nwhat you asked for\nwhat we propose\n\nScope\nin scope\nout of scope\n\nApproach\nDiscover :: what we learn first\nBuild :: what we deliver\nLaunch :: how it goes live\n\nTimeline\n| Phase | Weeks | Deliverable |\n| Discover | 2 | findings |\n| Build | 6 | working release |\n| Launch | 2 | go live |\n\nPricing\n| Item | Price |\n| Discover | TBD |\n| Build | TBD |\n| Launch | TBD |\n\nWhy us\nthe proof\n\nNext steps\nhow to accept' },
];
const SPREADSHEETS = [
    { id: 'budget', kind: 'xlsx', group: 'money', icon: '💰', name: 'Budget', desc: 'Plan and track money — income, fixed and variable costs with live totals.', title: 'Monthly Budget', theme: 'executive',
        prompt: 'e.g. a monthly household budget for a family of four in Tampa',
        outline: 'Income\nSalary: 5200\nSide work: 400\n\nFixed costs\nRent: 1500\nInsurance: 220\nUtilities: 180\nSubscriptions: 60\n\nVariable costs\nGroceries: 600\nTransport: 200\nEating out: 180\nOther: 150\n\nSavings\nEmergency fund: 400\nInvesting: 300\n\nLine items\n| Category | Planned | Actual | Notes |\n| Rent | 1500 | 1500 | fixed |\n| Groceries | 600 | 640 | |\n| Transport | 200 | 185 | |\n| Eating out | 180 | 210 | |\n\nHow to use this\nchange the numbers — every Total keeps computing\nadd a row to a table for a new line item' },
    { id: 'expenses', kind: 'xlsx', group: 'money', icon: '🧾', name: 'Expense report', desc: 'Claim what you spent — dated line items, categories, a total.', title: 'Expense Report', theme: 'monochrome',
        prompt: 'e.g. an expense report for a two-day client trip to Atlanta',
        outline: 'Claim\nName :: Your Name\nPeriod :: month and year\nSubmitted :: date\n\nExpenses\n| Date | Description | Category | Amount |\n| TBD | taxi to client | travel | 42 |\n| TBD | hotel one night | lodging | 189 |\n| TBD | working lunch | meals | 27 |\n\nBy category\nTravel: 42\nLodging: 189\nMeals: 27\n\nNotes\nattach receipts for anything over the limit' },
    { id: 'forecast', kind: 'xlsx', group: 'money', icon: '📉', name: 'Forecast', desc: 'Project the next periods — a series per line with totals to compare.', title: 'Forecast', theme: 'midnight',
        prompt: 'e.g. a four-quarter revenue forecast for a subscription app at 25% growth',
        outline: 'Revenue by quarter\nQ1: 120\nQ2: 150\nQ3: 190\nQ4: 240\n\nCosts by quarter\nQ1: 90\nQ2: 100\nQ3: 115\nQ4: 130\n\nAssumptions\nGrowth :: 25% quarter on quarter\nPrice :: unchanged\nHeadcount :: +2 in Q3\n\nScenarios\n| Scenario | Revenue | Costs | Net |\n| Base | 700 | 435 | 265 |\n| Upside | 840 | 460 | 380 |\n| Downside | 560 | 420 | 140 |' },
    { id: 'project-plan', kind: 'xlsx', group: 'plans', icon: '🗂️', name: 'Project plan', desc: 'Who does what by when — tasks, owners, dates, status.', title: 'Project Plan', theme: 'blueprint',
        prompt: 'e.g. a project plan for a website relaunch over twelve weeks',
        outline: 'Plan\n| Task | Owner | Start | End | Status |\n| Kickoff | TBD | TBD | TBD | done |\n| Discovery | TBD | TBD | TBD | in progress |\n| Build | TBD | TBD | TBD | not started |\n| Test | TBD | TBD | TBD | not started |\n| Launch | TBD | TBD | TBD | not started |\n\nMilestones\nKickoff :: date\nFirst review :: date\nGo live :: date\n\nEffort by phase\nDiscovery: 10\nBuild: 30\nTest: 10\nLaunch: 5\n\nRisks\n| Risk | Likelihood | Impact | Mitigation |\n| TBD | medium | high | TBD |' },
    { id: 'schedule', kind: 'xlsx', group: 'plans', icon: '📆', name: 'Schedule', desc: 'A week or a rota at a glance — days across, slots down.', title: 'Schedule', theme: 'sunrise',
        prompt: 'e.g. a weekly shift schedule for a coffee shop with six staff',
        outline: 'Week\n| Slot | Mon | Tue | Wed | Thu | Fri |\n| Morning | TBD | TBD | TBD | TBD | TBD |\n| Midday | TBD | TBD | TBD | TBD | TBD |\n| Afternoon | TBD | TBD | TBD | TBD | TBD |\n\nHours per person\nAlex: 20\nSam: 24\nJordan: 16\n\nNotes\nswap rules\nwho to call when someone is out' },
    { id: 'tracker', kind: 'xlsx', group: 'tracking', icon: '✅', name: 'Task tracker', desc: 'A running list with status and priority you update every day.', title: 'Task Tracker', theme: 'aurora',
        prompt: 'e.g. a task tracker for a kitchen renovation',
        outline: 'Tasks\n| Task | Priority | Status | Owner | Due |\n| TBD | high | todo | TBD | TBD |\n| TBD | medium | in progress | TBD | TBD |\n| TBD | low | done | TBD | TBD |\n\nBy status\nTodo: 4\nIn progress: 2\nDone: 7\n\nLegend\npriority :: high, medium, low\nstatus :: todo, in progress, blocked, done' },
    { id: 'kpi', kind: 'xlsx', group: 'tracking', icon: '📍', name: 'KPI dashboard', desc: 'The numbers that matter, side by side, with targets.', title: 'KPI Dashboard', theme: 'blueprint',
        prompt: 'e.g. a KPI dashboard for a customer-support team',
        outline: 'This month\n94% :: on-time delivery\n$1.2M :: revenue\n3.4x :: pipeline coverage\n12 :: new customers\n\nTrend\nJan: 80\nFeb: 86\nMar: 91\nApr: 94\n\nTargets\n| KPI | Target | Actual | Gap |\n| On-time delivery | 95 | 94 | -1 |\n| Revenue | 1300 | 1200 | -100 |\n| New customers | 10 | 12 | 2 |' },
    { id: 'inventory', kind: 'xlsx', group: 'tracking', icon: '📦', name: 'Inventory', desc: 'What you have, where it is, when to reorder.', title: 'Inventory', theme: 'monochrome',
        prompt: 'e.g. an inventory sheet for a small bike repair shop',
        outline: 'Stock\n| Item | SKU | Location | On hand | Reorder at | Unit cost |\n| TBD | TBD | shelf A | 24 | 10 | 4.5 |\n| TBD | TBD | shelf B | 6 | 8 | 12 |\n| TBD | TBD | back room | 40 | 20 | 1.25 |\n\nOn hand by location\nShelf A: 24\nShelf B: 6\nBack room: 40\n\nReorder rules\nbelow the reorder level :: order this week\ncount :: first Monday of the month' },
    { id: 'invoice', kind: 'xlsx', group: 'sales', icon: '💳', name: 'Invoice', desc: 'Bill for work — line items, quantities, subtotal, tax, total.', title: 'Invoice', theme: 'monochrome',
        prompt: 'e.g. an invoice for 12 hours of consulting at $150 an hour',
        outline: 'Invoice\nNumber :: INV-0001\nDate :: TBD\nDue :: TBD\nBill to :: customer name and address\n\nLine items\n| Item | Qty | Unit price | Amount |\n| TBD | 1 | 500 | 500 |\n| TBD | 4 | 120 | 480 |\n| TBD | 2 | 75 | 150 |\n\nTotals\nSubtotal: 1130\nTax: 90.4\n\nPayment\nbank details or payment link\nterms :: due in 30 days' },
    { id: 'pipeline', kind: 'xlsx', group: 'sales', icon: '🧲', name: 'Sales pipeline', desc: 'Every deal, its stage, value and next step.', title: 'Sales Pipeline', theme: 'executive',
        prompt: 'e.g. a sales pipeline for a B2B software team with eight open deals',
        outline: 'Deals\n| Account | Stage | Value | Owner | Next step | Close date |\n| TBD | qualified | 12000 | TBD | discovery call | TBD |\n| TBD | proposal | 30000 | TBD | send proposal | TBD |\n| TBD | negotiation | 18000 | TBD | legal review | TBD |\n\nValue by stage\nQualified: 12000\nProposal: 30000\nNegotiation: 18000\n\nThis quarter\n$60k :: open pipeline\n3 :: deals to close\n45% :: historical win rate' },
];
exports.OFFICE_STARTERS = [...DECKS, ...DOCUMENTS, ...SPREADSHEETS];
/**
 * @description The catalog as the routes serve it: kinds with their purpose groups, and every
 * starter with its outline. Static, per-user-free data; the mount's auth still applies.
 * @returns kinds + starters.
 */
function starterCatalog() {
    return { kinds: exports.STARTER_KINDS, starters: exports.OFFICE_STARTERS };
}
//# sourceMappingURL=office-starters.js.map