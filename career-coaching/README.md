# Career Coaching

Share a summary of your job search with your career coach for a few days, and stop sharing whenever you like.

- **Share with a coach** (job seeker): enter your coach's code, review exactly what they will see, press Share and
  confirm. People with access lists each coach with **Stop sharing**.
- **Shared with me** (coach): **Get my code** to give to clients; each client's seeker-shared snapshot shows counts
  by stage, applications recorded in the past 7 days and, when the client chose, their applications and next steps.

Counts only by default; access lasts 7 days by default and 30 at most. A coach never sees the seeker's account,
résumé, documents, mail or job links and can do nothing in Career.

A client's page reads their own Career counts, so a client also needs Intelligent Career's Job seeker role; the
**Coaching client** bundle can give it in the same assignment (tick **career-hunter** under **Optional components**).
The **Career coach** bundle gives nothing in Career.

Before it is useful, an operator installs `storage/relationships.json` for the organization. A coach sees a snapshot
only while the kernel confirms the person who shared it is still an active member (the `person.status` read, since
0.1.1); on a kernel without that read coach viewing stays closed. See [docs/deployment.md](docs/deployment.md).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
