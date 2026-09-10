# Application Home and integration work orders

Status: execution ledger, 2026-09-10. This is the connected-action companion to [the extraction ledger](APP-HOME-EXTRACTION-PLAN.md). The table records intended product behavior, not claims that receivers or source extractors have shipped. Implementation and live acceptance are separate below.

Every row requires app-owned evidence, meaningful empty/unavailable states, source freshness, saved display choices, and a reviewed destination. The arrows are optional integrations unless the existing manifest already declares the target as a required dependency. They never install packages automatically. Existing file exchanges use ADR-139. Context exchanges use the versioned app integration contract; the receiving application prepares a draft and owns execution.

| Application | Card should lead with | Connected actions to implement / disposition |
|---|---|---|
| Hello OSHAL | Compact author example | Demonstrate a context receiver with sample data clearly labeled; no business status. |
| Little Monsters | Work due, teacher feedback, next learning activity | Class material → Tutor using existing artifact exchange; completed creative work → Storage; family communications require guardian/teacher visibility. |
| Brand Graphics | Latest render and review decision | Approved brief from Marketing → branded render; finished video → Video/Storage/Marketing review. Requested render is not completed output. |
| LoRA Studio | Training stage and evaluated model preview | Approved Portrait character assets → training dataset through an owner-scoped ingest route; evaluated model → Portrait/Video selection. No new ingest until dataset ownership is enforced. |
| Kid Lens | Latest imported viewing-history brief | Uploaded Takeout → existing artifact import; parent-reviewed interests → learning/activity suggestions. Uploaded history is not live viewing telemetry. |
| Payments | Confirmed receipts and failed charge attempts | Approved billing request → payment draft; confirmed transaction → Finance reconciliation. No invoice counts without a real invoice ledger. |
| Finance | Actual account changes and reconciliation needs | Payment/payroll evidence → transaction review; budget choice → Shopping/Travel planning context. Model estimates remain distinct from balances. |
| Movies & TV | Saved watchlist and next viewing choice | Reviewed household occasion → movie shortlist; selected title → provider deep link. No claims about unwatched/unseen without saved history. |
| Spotify | Saved preferences or compact listening launcher | Activity/mood → playlist search draft; chosen playlist → Spotify link. No fake playback or listening metrics. |
| Get a Ride | Saved trip preparation and departure context | Travel/calendar destination → ride estimate request; estimate → provider handoff. Handoff is not a booked ride. |
| Eats | Saved meal choices and household constraints | Occasion → meal discussion; Shopping → ingredient list draft; restaurant selection → provider link. No automatic order. |
| Shopping | Current list, saved suggestions, unfinished decision | Occasion/budget/recipient context → concierge draft; chosen product → verified retailer deep link; purchase completion requires retailer evidence. |
| Career Hunter | Matches worth reviewing and application progression | Job match → resume/cover preparation; submission evidence → communications follow-up; generated documents use artifact exchange. |
| AI Office | Recent document and deliverable preview | Research/opportunity/venture brief → document draft; finished document → Storage/Email/Print through artifact exchange. |
| Storage | Recently saved useful files and unfinished uploads | Receives produced artifacts; selected document → Office/RAG/Email using existing owner-scoped handles. |
| Portrait Studio | Latest image and next creative decision | Image artifact → existing restyle receiver; selected output → Marketing/Office/Video asset preparation. |
| Smart Home | Observed device state and actionable issues | Device observation → Operations diagnostic request; selected household routine → reviewed automation. Never infer occupancy from unrelated signals. |
| Social | Cached relevant social messages and discussion | Selected discussion → Switchboard response draft; approved campaign context → social draft. No invented direct-message or unread counts. |
| Job Apply | Confirmed application state, failures, next review | Reviewed career packet → application preparation; confirmed response/interview → Calendar/Communications follow-up. Submission remains separately authorized. |
| Feeds | Relevant indexed entries with channel and age | Selected entry → research brief or communication draft; World receives topic candidates, not automatic ingestion on Home load. |
| Cloud | Actual jobs/resources needing attention | Operations incident → cloud diagnostic context; deployment result → Operations review. Creation/deletion stays explicitly authorized. |
| Identity Hub | Expiring credentials, reconnects, missing chosen-work connections | An app's declared requirement → exact provider connection flow; return to originating work after connection. Stored metadata is not provider liveness. |
| Travel | Saved itinerary, upcoming trip, unresolved choice | Calendar event → travel plan draft; itinerary → Ride/Eats/Shopping preparation; confirmed booking evidence → Calendar. |
| Camera Ops | Registered camera state and saved capture result | Explicit capture → Storage/Spaces review; observation → Operations incident draft. No passive collection added by dashboard. |
| Drone Ops | Mission state, captured artifacts, intervention | Reviewed mission → execution approval; actual imagery → Spaces/Storage/analysis, preserving simulated/live status. |
| Spaces | Latest reconstruction and reviewable preview | Existing video artifact import → reconstruction; selected reconstruction → project/document review; failed processing → Operations. |
| Sat Ops | Recorded simulation/telemetry and next analysis | Scenario/observation → analysis brief or Storage artifact; distinguish simulation from physical satellite command throughout. |
| Pumpkin | Session/character launcher unless activity is persisted | Approved character/creative assets → scene preparation; no fabricated always-running status. |
| Creative Studio | Member deliverables and creative decisions | Aggregate existing member evidence; route brief among Portrait/Video/LoRA, without duplicate extraction or wider permissions. |
| Daily Trade Recap | Latest saved recap and source period | Recorded trading results → review brief; approved commentary → Office/Communications draft. Never present model commentary as fills. |
| Video Studio | Episode/render preview and next production step | Brief/assets → episode draft; produced video → Storage/Marketing publishing review. |
| Vids Studio | Actual queued/running/completed render jobs | Approved Brand/Marketing brief → render preparation; successful artifact → distribution review. |
| Intelligent Communication | Important saved digest content with generation age | Selected commitment → Calendar/task draft; opportunity → Sales review; source mail/thread reference retained and reauthorized. |
| Kalshi | Actual exposure, prediction outcome, research decision | World finding → market research draft; results → Finance/Recap; paper/live and forecast/fill stay distinct. |
| Intelligent Trades | Account exposure, actual fills and pending decisions | World research → symbol/research review; recorded results → Recap/Finance. A dashboard suggestion never submits a trade. |
| World Intelligence | Recent developments, evidence, coverage changes, upcoming recorded events | Sourced finding → Venture/Office research draft; matched company/topic → Trading/Sales/Marketing research review. Article volume supports the briefing, not the headline. |
| Dungeon Master | Saved campaign/session and next player choice | Existing character artifact receiver; campaign/session preparation → Calendar draft only if a real event receiver exists. |
| Game Show | Saved/current session or compact launcher | Approved session idea → session setup; results → share draft only when recorded and selected. |
| Games | Resume an actual saved session or choose a game | Optional social invitation draft; no connection requirements invented for local play. |
| AI Bake-Off | Saved comparison and evidence behind scores | Candidate tool/model from Ideation → bounded evaluation draft; completed evidence → Ideation decision. |
| Life | Member preparation items and upcoming commitments | Compose household app suggestions; Calendar/Travel/Shopping/Eats actions retain each member's ownership. |
| Switchboard | Conversations, publishing approvals, overdue/failed work | Communication/Marketing context → reply/post draft; approvals → existing publish review; content calendar is not a personal events calendar. |
| Intelligent Career group | Most consequential member match, response, or decision | Compose Career Hunter/Job Apply capabilities; preserve exact member destination and avoid duplicate application counts. |
| System | Verified service/device issues and recent changes | App failure → Operations diagnostic draft; user chooses any repair. Mere absence of metrics is not an incident. |
| Payroll | Run needing approval, bank return, filing deadline | Approved employee/pay context → payroll preparation; generated files → existing artifact exchange; confirmed bank evidence → Finance. Generated payment file is not wages paid. |
| Venture Plan | Current venture, unsupported assumptions, next decision | Sourced World/Sales idea → venture draft; approved findings → Office/Marketing plan; research cost remains an explicit action. |
| Ocean Lab | Compact simulation setup or saved run results | Scenario → simulation draft; exported result → Office/Storage; no claims about real-world observations. |
| Marketing Engine | Campaign results, content decisions, publishing queue | World/Sales insight → campaign draft; approved brief → Creative apps; approved content → Switchboard; actual results feed campaign review. |
| Aero Lab | Latest run and engineering tradeoff | Reviewed design scenario → run preparation; real exported artifact → Storage/Office via existing download. Simulation is labeled. |
| Print Ingest | Document needing review, extraction failure, filing result | Existing artifact receiver → print inbox; reviewed document → Storage/RAG/Office; printing/ingestion never inferred from file generation. |
| Sports Edge | Followed-team development and fantasy decision | World sports subject → research review; real fixture → Calendar draft; fantasy roster changes remain explicitly authorized. |

## Kernel and private applications

Calendar needs a true personal-event source/receiver assessment; Switchboard's content schedule cannot stand in for birthdays or appointments. Capability Ideation needs its installed source owner located and must show persisted discoveries linked to business processes, required connections, evaluations and decisions. Private Sales needs its own visibility rules and consistent business-timezone cohorts before publishing lead/customer/conversion facts. These are additional work orders, not silently covered by the 51 store entries.

Calendar source assessment found core's `google-calendar-service.ts` (provider reads/writes used by Little Monsters) and `personal-graph/ingest/google-calendar-ingest.ts` (a pure mapper retaining event titles, start/end, location and source references). The cockpit Calendar view itself reads work queues and agent schedules. A personal-event dashboard must use authorized saved event records, define cancellation/recurrence and freshness behavior, and add an app-owned receiving surface; calling the provider service on each Home load does not satisfy the extraction contract.

Kernel task/operations/security/workflow apps use existing authorized records: completed work, incidents, scan findings, approvals and saved workflow drafts. Their useful exchanges are diagnostic requests, workflow proposals and reviewable delivery artifacts. Owner and operator boundaries apply to inbound contexts as well as dashboard reads.

## Execution evidence

### Native application workflow batch (implemented; rollout pending)

| Source | Selected context | Destination / receiving controls |
|---|---|---|
| World | Saved article title, evidence and source URL | Office title/outline; relevant commercial research also opens Marketing's campaign name/research brief or Venture's idea draft. |
| Venture | Currently selected venture name and idea | Office document draft or Marketing campaign draft. |
| Office | Editable document title and outline | Marketing campaign name and research brief; product and publication choices stay explicit. |
| Marketing | Expanded campaign's product, ICP and message map | Office title and outline. |
| Travel | Explicitly searched flight/hotel/car parameters, labeled unconfirmed | Ride, meal or shopping concierge input. |
| Rides | Entered destination, pickup and current planning request | Meal or travel concierge input. |
| Eats | Entered meal request and location | Shopping or ride concierge input. |
| Shopping | Entered shopping search/planning request | Meal concierge input. |
| Feeds | One of the caller's three most recent indexed entries within five days, with channel and timestamp | Office brief or Switchboard post source; no indexing or generation on Home load. |
| Intelligent Communication | The caller's decrypted saved digest, retaining its recorded generation age | Office brief or Sales Assistant review question. |
| Switchboard | Editable Compose source | Social post editor or Office outline. |
| Social | Editable post text | Switchboard Compose source or Office outline. |
| Office / Marketing | Editable outline / expanded campaign brief | Vids clip prompt or Video episode idea; the render remains an explicit action. Office and Marketing also prepare Switchboard or Social drafts. |
| Vids / Video | Current editable production brief | Other video studio or Office draft. Brand Graphics and Creative Studio use the Vids screen through their existing loaded dependency. |
| Private Sales | Authorized opened record's identity, description and current roles | Office or Marketing brief. Incoming World/mail research fills the Assistant after its normal access check, without creating leads or contacting anyone. |

These actions operate from the apps themselves through the current cockpit frame. The caller-visible catalog includes grouped members and apps without summary extractors. Missing or incompatible partners are explained; targets are rechecked when clicked. Native receiving controls remain editable and their existing Send/Create/Generate buttons own execution. The receiving Marketing form now preserves research notes in the campaign message map when the user explicitly creates it. File exports continue through the existing artifact exchange.

Versions: Office 2.7.0, Marketing 0.2.0, Venture 1.2.0, World 1.2.0, Travel/Shopping/Eats 1.1.0, Rides 1.2.0. This is implementation evidence, not a claim that the remainder of the ledger is complete.

Communications and production extend this batch with Switchboard 0.6.0, Social 1.2.0, Feeds/Email Summarizer 1.2.0 and new minor releases of Vids/Video. Private Sales 1.15.0 ships from its private repository. Marketing and Office exchange briefs, not approvals to publish. Home offers up to four actions per item; native app screens expose their declared actions from selected work. The browser fixture reads the actual manifests, loads the actual receiving HTML and compiled Vids template, and checks that the chains create no business writes. Run `node scripts/app-workflows.browser.cjs` with the sibling core checkout and its Playwright dependencies; extractor boundaries run with `node --test scripts/home-summary.test.cjs world/tests/home-summary.test.cjs`.

- Existing live extractors: Identity, Feeds, Email Summarizer, Switchboard and World; see extraction ledger for their precise current scope.
- Versioned context foundation deployed in core #416/#417. The actual authenticated Home opens a loaded receiver even without a ribbon shortcut; the real World → Venture draft handoff passed with zero business writes. No other row is marked integrated merely because it appears in this table.
- World 1.1.1 is installed from store `a40da619` (PR #157), with Venture Plan 1.1.0 from `a2219f4e` (PR #155). Core `c7b5e58a` (PR #418) provides bounded subject selection and expanded briefing cards. The actual authenticated summary returned HTTP 200, no partial sources, in 138 ms during acceptance. Its three current stories covered AI, housing and markets; only the qualifying AI article offered Venture. Clicking that action populated the real Venture draft with its source URL and made zero package business writes. Temporary verification credentials were revoked.
- Validation: 39 focused core tests, both TypeScript configurations, scoped lint, 17 compiled package tests, package/catalog parity, and the actual Home/controller/Venture fixture pass. Desktop briefing width and mobile overflow checks pass. Existing whole-store dnd/little-monsters/spaces failures remain unrelated to this release.
- App-specific receiving surfaces, rich extraction and live acceptance remain tracked work until tested and deployed.
