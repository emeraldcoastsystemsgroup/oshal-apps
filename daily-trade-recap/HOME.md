# daily-trade-recap on Home

Counts exact-owner Eastern trading days: sessions recorded by the trading schedule, published reports recorded by the recap pipeline, and recap tickets parked at their approval gate. Today is excluded because the after-close recap has not run yet. A recorded report is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `recaps-missed` — Sessions with no recap / 7 days | `missed` in the first SELECT below |
| `recaps-recorded` — Recaps recorded / 7 days | `recaps` in the first SELECT below |
| `trading-sessions` — Trading sessions / 7 days | `sessions` in the first SELECT below |
| `recaps-awaiting-review` — Recaps awaiting review | `review` in the second SELECT below |

## Which record is the truth for this app

The production recap is a **host scheduled task** (`scripts/run-daily-recap.ps1`). It creates no ticket and no workflow run, so a summary counting `workflow_runs` for ticket type `daily-trade-recap` reads `0` on a good night and a bad one alike — there has never been a row of that type to count. The records the pipeline really leaves behind are:

- **a recorded trading session** — `oshal_trading_daily_equity`, written by the trading schedule during the session. It is independent of the recap, so it says a recap was *due*. A market holiday records no session, so a holiday raises nothing.
- **the day's published report** — `oshal_trading_strategy_journal` with `kind='report'` and `source='daily-report'`, written by the recap's own publish step (`scripts/oshal-report-journal.js`, invoked from `publish-agenticfederal-recap.ps1`). It says the recap *ran to publication*.
- **the parked tickets** — `tickets` at `approval_required` for this ticket type. The ticket path was last exercised in June and those tickets are still parked; workflow-run states could never see them, because they are ticket states.

A closed session with no published report is counted in `recaps-missed` **and named as a warn item** carrying its date, so a failed nightly is visible on Home without opening the run log. Today is never judged: the trading schedule records equity during the session, hours before the after-close recap runs, so counting today would report every normal afternoon as a miss — a session is judged from the next day onward.

What this cannot tell you: **why** a recap is missing. The record is an absence, not a recorded failure reason. The runner still emails and Telegrams its own failure at the time it happens.

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. `oshal_trading_daily_equity` and `oshal_trading_strategy_journal` are deliberately not RLS-walled (core migration 112 excludes both: host report CLIs read them over the app DSN with no GUC stamp), so the explicit `user_sub = $1` filter is the isolation boundary on those two and is proven against a real server in `scripts/media-home.integration.cjs`. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `recap-review`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT (SELECT count(DISTINCT et_day)::text FROM oshal_trading_daily_equity WHERE user_sub = $1 AND et_day < ($2::timestamptz AT TIME ZONE 'America/New_York')::date AND et_day > (($2::timestamptz AT TIME ZONE 'America/New_York')::date - 7)) AS sessions, (SELECT count(DISTINCT et_day)::text FROM oshal_trading_strategy_journal WHERE user_sub = $1 AND kind='report' AND source='daily-report' AND et_day < ($2::timestamptz AT TIME ZONE 'America/New_York')::date AND et_day > (($2::timestamptz AT TIME ZONE 'America/New_York')::date - 7)) AS recaps, (SELECT count(*)::text FROM (SELECT DISTINCT et_day FROM oshal_trading_daily_equity WHERE user_sub = $1 AND et_day < ($2::timestamptz AT TIME ZONE 'America/New_York')::date AND et_day > (($2::timestamptz AT TIME ZONE 'America/New_York')::date - 7)) e WHERE NOT EXISTS (SELECT 1 FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND j.kind='report' AND j.source='daily-report' AND j.et_day = e.et_day)) AS missed
```

```sql
SELECT count(*)::text AS review FROM tickets WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND status='approval_required' AND created_at <= $2
```

```sql
SELECT to_char(e.et_day,'YYYY-MM-DD') AS session_day, (SELECT max(j.created_at) FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND j.kind='report' AND j.source='daily-report' AND j.et_day = e.et_day) AS recap_at, (SELECT left(max(j.summary),400) FROM oshal_trading_strategy_journal j WHERE j.user_sub = $1 AND j.kind='report' AND j.source='daily-report' AND j.et_day = e.et_day) AS recap_summary FROM (SELECT DISTINCT et_day FROM oshal_trading_daily_equity WHERE user_sub = $1 AND et_day < ($2::timestamptz AT TIME ZONE 'America/New_York')::date AND et_day > (($2::timestamptz AT TIME ZONE 'America/New_York')::date - 7)) e ORDER BY e.et_day DESC LIMIT 5
```

```sql
SELECT title, status, created_at FROM tickets WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND status='approval_required' AND created_at <= $2 ORDER BY created_at DESC, ticket_id LIMIT 3
```
