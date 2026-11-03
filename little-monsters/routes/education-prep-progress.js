"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarize = summarize;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Separate knowledge, pace, repeated exposure and comparable improvement.
 */
const education_prep_model_1 = require("./education-prep-model");
function median(values) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function accuracy(items) {
    return items.length ? Math.round(items.filter(i => i.correct).length / items.length * 100) : null;
}
function summarize(rows, exam, now, science = true) {
    const completed = rows.filter(r => r.state.exam === exam && r.state.status === 'complete')
        .sort((a, b) => a.state.completedAt - b.state.completedAt);
    const seen = new Set();
    const samples = [];
    let repeats = 0;
    const history = completed.map(({ session_id, state }) => {
        let count = 0, correct = 0, ms = 0;
        for (const b of state.blocks)
            for (const q of b.questions) {
                const a = b.answers[q.id], ok = a?.choice === q.answer;
                count++;
                correct += Number(ok);
                ms += a?.ms || 0;
                if (seen.has(q.id)) {
                    repeats++;
                    continue;
                }
                seen.add(q.id);
                samples.push({ id: q.id, skill: q.skill, correct: ok, seconds: (a?.ms || 0) / 1000,
                    ratio: a?.ms > 0 ? a.ms / (q.targetSeconds * state.multiplier * 1000) : null, date: state.completedAt });
            }
        return { id: session_id, mode: state.mode, date: state.completedAt, count, correct,
            accuracy: Math.round(correct / count * 100), activeSeconds: Math.round(ms / 1000) };
    });
    const skills = (0, education_prep_model_1.availableLessons)(exam, science).map(lesson => {
        const all = samples.filter(s => s.skill === lesson.id), recent = all.slice(-5);
        const pct = accuracy(recent), pace = median(recent.filter(s => s.correct && s.ratio !== null).map(s => s.ratio));
        const lastAt = all.at(-1)?.date || null;
        const days = !lastAt ? Infinity : (now - lastAt) / 86400000;
        const status = all.length < 5 ? 'assess' : pct < 80 ? 'learn' : pace !== null && pace > 1.25 ? 'pace' : pace === null ? 'assess' : 'maintain';
        const due = days >= (status === 'maintain' ? 7 : 1);
        const baseline = all.length >= 10 ? all.slice(0, 5) : [];
        const baselineSeconds = median(baseline.filter(s => s.correct && s.ratio !== null).map(s => s.seconds));
        const recentSeconds = median(recent.filter(s => s.correct && s.ratio !== null).map(s => s.seconds));
        // Normalized ratios compare the same skill fairly when practice accommodations change.
        const baselinePace = median(baseline.filter(s => s.correct && s.ratio !== null).map(s => s.ratio));
        return { id: lesson.id, title: lesson.title, section: lesson.sections[exam], samples: all.length,
            accuracy: pct, paceRatio: pace === null ? null : Math.round(pace * 100) / 100,
            medianSeconds: recentSeconds === null ? null : Math.round(recentSeconds), status, due, lastAt,
            priority: (status === 'learn' ? 400 : status === 'pace' ? 300 : status === 'assess' ? 200 : 0) + (due ? 20 : 0) + (100 - (pct ?? 0)),
            reason: status === 'assess' ? `${all.length}/5 fresh questions; more evidence needed` : status === 'learn' ? `${pct}% recent accuracy; rebuild the concept` : status === 'pace' ? `${pace.toFixed(2)}× target time on correct answers` : due ? 'Ready for spaced review' : 'Keep this skill warm',
            improvement: baseline.length ? { accuracyPoints: pct - accuracy(baseline), baselineSeconds,
                paceRatioChange: baselinePace !== null && pace !== null ? Math.round((pace - baselinePace) * 100) / 100 : null,
                baselineCount: 5, recentCount: recent.length } : null };
    });
    skills.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return { exam, skills, focus: skills.filter(s => s.status !== 'maintain' || s.due).slice(0, 3),
        history: history.reverse(), freshQuestions: seen.size, repeatedQuestions: repeats,
        seen: [...seen], window: 'Latest 200 completed sessions; mastery uses first exposure to each question ID. Template variants are related practice, not independent proof of exam readiness.' };
}
//# sourceMappingURL=education-prep-progress.js.map