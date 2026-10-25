# Reviewed local education and community sources

`tools/career-local-sources.json` is a curated **Northwest Florida / Emerald Coast**
directory, not nationwide coverage or a record of installed sources. `available-feed`
means a public adapter and a real public response were verified; it does not mean the
source has been added to this installation. `external-only` remains an official link,
with no feed enrollment or fabricated empty result. Application-managed Settings requires an
explicit Add for supported feeds; native source enrollment is managed by the installation. This file does not run an ingest or mutate the database.

Reviewed 24 October 2026:

| Organization | Official entry | Ingestion support / observed read |
|---|---|---|
| University of West Florida | [Official jobs](https://careers.uwf.edu/jobs/search) | Public PageUp table, 72 rows across completed pagination. Includes faculty, staff, temporary and student postings. |
| Pensacola State College | [Official employment page](https://pensacolastate.edu/employment/) | Its linked public Workday boards returned 28 staff/full-time faculty and 48 adjunct openings. Existing Workday adapter; boards remain distinct sources. |
| Okaloosa County BCC | [Official application page](https://www.myokaloosa.com/hr/application) | Its linked [GovernmentJobs board](https://www.governmentjobs.com/careers/okaloosa) returned 11 openings across completed public pagination. |
| Northwest Florida State College | [Official Human Resources](https://www.nwfsc.edu/about/human-resources/) | Links `nwfsc.interviewexchange.com/static/clients/531NFM1/index.jsp`; automated public read returned 403 WAF. No adapter/enrollment or claim of no vacancies. |
| Okaloosa schools | [Official employment](https://www.okaloosaschools.com/page/employment) | Links `okaloosa.focusschoolsoftware.com/focus/jobs/`, a Focus public application. Controller-based listing has no reviewed adapter in this increment. |
| Walton schools | [Official employment](https://www.walton.k12.fl.us/page/employment) | Links PowerSchool `ats3.atenterprise.powerschool.com/ats/app_login?COMPANY_ID=WA002771`; automated read redirects to Unsupported Browser. External-only. |
| Walton County BCC | [Official careers](https://www.mywaltonfl.gov/1189/Careers) | Links `waltoncountyfl.munisselfservice.com/default.aspx`; automated read redirects to Upgrade Browser. No reviewed Munis adapter. |

All four supported boards were fully enumerated with complete feed metadata (159 rows total).
Workday location labels such as "Pensacola Campus", "7 Locations" or absent locations
remain the source labels. An employer address is never substituted to manufacture coordinates;
rows without an unambiguous posting location stay outside radius results.

Counts describe the public responses at review time, not saved corpus counts or guaranteed
future vacancies. Credentials, account creation and applications are outside these readers.
No protection challenge was bypassed.

## New readers

`engine/jobhunter/public_education_ats.py` adds two narrow adapters:

- `PageUp`: the reviewed UWF public table variant, with explicit requisition IDs and
  location cells. Other PageUp variants remain unclaimed.
- `GovernmentJobs`: the same anonymous GET used by NEOGOV's public agency screen:
  `https://www.governmentjobs.com/careers/home/index?agency=<agency>&page=<page>`.
  The agency parameter is retained across pagination. No applicant-account endpoint is used.

Both return the shared `Feed` metadata. Only recognized, fully read pagination is marked
complete; HTTP refusals, changed markup, invalid/repeated pagination, malformed rows and
bounds produce partial/unavailable evidence. Advertised locations are retained directly;
organization headquarters are never inserted as job locations. GovernmentJobs pay is
retained only from explicit dollar amounts in its salary metadata, with its advertised
period. A closing date is never substituted for an unknown posting date.

These feeds use the existing company discovery, corpus upsert and source-memory rails.
Tests exercise pagination and then ingest normalized rows into a disposable real SQLite
corpus using the production `db.upsert_posting`, proving searchable records rather than
only collecting links. Live enrollment and ingest require a separately reviewed action
under the native corpus writer coordination.
