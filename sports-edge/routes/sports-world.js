"use strict";
/**
 * The bridge from a followed team to the shared World Intelligence layer.
 *
 * The operator's rule, and it is the right one: every application's unstructured signal goes
 * through World, so two apps never pull the same feed twice and every archived item is classified
 * once against one standard. This package therefore does NOT own a news reader. It names its
 * subjects — a team, its coach, its injuries, the specific matchup about to be played — and hands
 * them to the layer that already knows how to fetch, dedupe by content hash, classify, and store a
 * time series with a correlation map behind it.
 *
 * WHY THIS IS A NAMING PROBLEM AND NOT A FETCHING ONE. `world_items` is keyed by a namespaced
 * entity URN, so `world:team:ncaaf-arkansas-razorbacks` needs no schema change and no new table —
 * it needs a stable id that means the same thing on every pass. That stability is the whole value:
 * a subject that is spelled two ways is two half-empty archives, and the sentiment series over
 * either one is a lie of omission. Hence one derivation function, used everywhere, with the slug
 * pinned by tests rather than recomputed at each call site.
 *
 * WHAT IS DELIBERATELY NOT HERE: odds, rosters, scores and line history are STRUCTURED facts with
 * a schema, an owner and a settlement path. They stay in this package's own tables. World is the
 * unstructured layer — news, blogs, message boards, wires — and mixing the two would put facts we
 * are accountable for into a store built for signals we merely observe.
 *
 * No framework imports, so the compiled module loads under the plain-node test suites; the I/O
 * half takes the World service as a parameter rather than constructing one.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — stable world entity ids for teams, coaches and matchups, the per-league subject sets a followed team expands into, the news/social feed selection (regulatory and medical feeds are noise here), and the ingest pass with a per-entity cool-down so a restart cannot re-classify the same archive.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refuse missing or unusable coach names before a person subject can reach the shared archive.
 *
 * @module sports-world
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPORTS_FEED_IDS = void 0;
exports.teamEntityId = teamEntityId;
exports.coachEntityId = coachEntityId;
exports.matchupEntityId = matchupEntityId;
exports.teamSubjects = teamSubjects;
exports.coachSubject = coachSubject;
exports.matchupSubject = matchupSubject;
exports.dedupeSubjects = dedupeSubjects;
exports.dueSubjects = dueSubjects;
exports.ingestSubject = ingestSubject;
/**
 * The sport name each league is actually written about in.
 *
 * This is a disambiguation term, not decoration. "Arkansas" alone returns the state, the river and
 * the legislature; "Arkansas Razorbacks college football" returns the team. A query that pulls the
 * wrong subject does not fail — it fills the archive with irrelevant items that then get classified
 * at cost and weighted into a sentiment series, which is worse than pulling nothing.
 */
const LEAGUE_TERMS = {
    nfl: 'NFL',
    nba: 'NBA',
    ncaaf: 'college football',
};
/**
 * News and social only.
 *
 * The World registry also carries regulatory, medical and legal feeds. For a football team the
 * Federal Register and ClinicalTrials.gov return nothing on topic, and every empty pull still costs
 * a request and a slot in the pass. Beat writers, wires and message boards are where a scratched
 * starter or a coach's Monday presser actually surfaces first.
 */
exports.SPORTS_FEED_IDS = ['google-news', 'bing-news', 'reddit'];
/** Lower-case, hyphenated, ASCII — the same slug every time, whatever the display name looks like. */
function slug(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
/**
 * @description The canonical world entity id for a team.
 *
 * League-qualified deliberately: there is an NFL and a college team called the Cardinals, and
 * collapsing them would merge two archives into one that describes neither.
 * @param league - Which league the team plays in.
 * @param team - The team's ESPN abbreviation or name.
 * @returns A `world:team:<league>-<slug>` URN.
 */
function teamEntityId(league, team) {
    return `world:team:${league}-${slug(team)}`;
}
/**
 * @description The canonical world entity id for a coach, who is a person and therefore keeps the
 * same id across the teams they coach.
 * @param name - The coach's name.
 * @returns A `world:person:<slug>` URN.
 */
function coachEntityId(name) {
    if (typeof name !== 'string' || !slug(name) || /\b(undefined|null|unknown|tbd)\b/i.test(name)) {
        throw new Error('A named coach is required for a World person subject');
    }
    return `world:person:${slug(name)}`;
}
/**
 * @description The canonical world entity id for one specific game.
 *
 * Keyed by the ESPN event id rather than by the two team names, because the same fixture is played
 * again next season and the wire coverage of the two is not interchangeable.
 * @param league - Which league.
 * @param eventId - ESPN event id.
 * @returns A `world:matchup:<league>-<eventId>` URN.
 */
function matchupEntityId(league, eventId) {
    return `world:matchup:${league}-${slug(eventId)}`;
}
/**
 * @description The subjects one followed team expands into.
 *
 * Two subjects, not one, and the split is the point. General team coverage and the injury wire
 * behave completely differently: team news is a slow-moving sentiment series, while an injury item
 * is a step change that matters for hours and is what actually moves a line. Archiving them under
 * one entity averages a scratched quarterback into a week of press-conference filler and the signal
 * disappears into the noise it is supposed to be read against.
 * @param t - The followed team.
 * @returns The subject set, stable for a given team.
 */
function teamSubjects(t) {
    const name = (t.displayName || t.team || '').trim() || t.team;
    const sport = LEAGUE_TERMS[t.league];
    const entity = teamEntityId(t.league, t.team);
    return [
        {
            entity,
            label: name,
            query: `${name} ${sport}`,
            kind: 'team',
        },
        {
            // A sub-entity, so the injury series can be read on its own without a second archive to
            // reconcile against the first.
            entity: `${entity}:injuries`,
            label: `${name} — injuries`,
            query: `${name} ${sport} injury report depth chart`,
            kind: 'injuries',
        },
    ];
}
/**
 * @description The subject for a coach, when one is known.
 * @param name - The coach's name.
 * @param teamName - Their team, used to disambiguate a common name.
 * @param league - Which league, for the sport term.
 * @returns One subject, or null when no usable coach is known.
 */
function coachSubject(name, teamName, league) {
    if (typeof name !== 'string' || !slug(name) || /\b(undefined|null|unknown|tbd)\b/i.test(name))
        return null;
    return {
        entity: coachEntityId(name),
        label: name,
        query: `${name} ${teamName} ${LEAGUE_TERMS[league]}`,
        kind: 'coach',
    };
}
/**
 * @description The subject for a specific upcoming game — the matchup preview coverage that exists
 * for a few days around a kickoff and then stops.
 * @param league - Which league.
 * @param eventId - ESPN event id.
 * @param homeName - Home team display name.
 * @param awayName - Away team display name.
 * @returns One subject.
 */
function matchupSubject(league, eventId, homeName, awayName) {
    return {
        entity: matchupEntityId(league, eventId),
        label: `${awayName} at ${homeName}`,
        query: `${awayName} vs ${homeName} ${LEAGUE_TERMS[league]} preview prediction`,
        kind: 'matchup',
    };
}
/**
 * @description Deduplicate a subject list by entity id, keeping the first spelling.
 *
 * Two followed teams that play each other produce the same matchup subject, and ingesting it twice
 * in one pass pays for the same classification twice for zero new items.
 * @param subjects - Subjects, possibly with repeats.
 * @returns Subjects, unique by entity.
 */
function dedupeSubjects(subjects) {
    const seen = new Set();
    const out = [];
    for (const s of subjects) {
        if (seen.has(s.entity))
            continue;
        seen.add(s.entity);
        out.push(s);
    }
    return out;
}
/**
 * @description Which subjects are due, given when each was last pulled.
 *
 * The cool-down exists because a re-pull is not free even when it returns nothing new: the feeds
 * are fetched, and anything unseen is classified by a model. World dedupes by content hash so a
 * re-pull cannot corrupt the archive — it can only waste money — which is exactly the kind of cost
 * that goes unnoticed until it is large. A restart must not restart the clock, so the timestamps
 * come from storage rather than from process memory.
 * @param subjects - Candidate subjects.
 * @param lastPulled - Entity id → ISO timestamp of the last pull, for those ever pulled.
 * @param cooldownHours - Minimum hours between pulls of one subject.
 * @param now - Current time, injected so the rule is testable.
 * @returns The subjects due for a pull, in the order given.
 */
function dueSubjects(subjects, lastPulled, cooldownHours, now = new Date()) {
    const floor = now.getTime() - cooldownHours * 3600_000;
    return subjects.filter((s) => {
        const last = lastPulled.get(s.entity);
        if (!last)
            return true;
        const at = Date.parse(last);
        // An unparseable timestamp must not silently pin a subject as "never due" — treat it as due and
        // let the next successful pull overwrite it with something readable.
        return !Number.isFinite(at) || at < floor;
    });
}
/**
 * @description Pull one subject through World and reduce the per-source detail to counts.
 *
 * A failure is CAUGHT and returned rather than thrown. One unreachable feed must not abort a pass
 * that is also capturing lines and grading settled calls — those have deadlines, this does not.
 * @param ingest - The World ingest call.
 * @param subject - The subject to pull.
 * @param limit - Items per feed variant.
 * @returns Counts, or the error text.
 */
async function ingestSubject(ingest, subject, limit) {
    try {
        const r = await ingest(subject.query, subject.entity, subject.label, [...exports.SPORTS_FEED_IDS], { limit });
        const rows = r?.perSource || [];
        return {
            entity: subject.entity,
            fetched: rows.reduce((n, s) => n + (Number(s.fetched) || 0), 0),
            newItems: rows.reduce((n, s) => n + (Number(s.newItems) || 0), 0),
        };
    }
    catch (e) {
        return { entity: subject.entity, fetched: 0, newItems: 0, error: e.message };
    }
}
//# sourceMappingURL=sports-world.js.map