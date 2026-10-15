"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Every Eats suggestion is checked against the diner's allergies and diet. Demo sweep 2: right after "I have noted your peanut allergy" the concierge suggested "a Vegetarian Pad Thai" (usually made with peanuts) with no warning, because nothing in the route knew which dishes carry which allergen. The restrictions come from what the diner said in this message, the concierge's saved notes and the profile's dietary list; a menu dish that names an allergen or is usually made with it is held back from the concierge and the cards, and a dish the reply names that usually carries one, in a sentence that does not name the risk, gets a structural allergy-check line. Guard: tests/eats-allergens.test.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Generic nut phrasing ("I have a nut allergy", "allergic to nuts", "tree nuts", "no nuts") now restricts both peanuts and tree nuts, and a sentence that names the allergen while recommending a dish ("Try the Thai Peanut Noodles.") still gets the allergy-check line unless the sentence carries an explicit warning marker. Guard: tests/eats-allergens.test.js.
 */
/** Which dishes the diner's allergies and diet rule out: the restrictions, and the dishes that conflict with them. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dinerRestrictions = dinerRestrictions;
exports.dishConflicts = dishConflicts;
exports.holdConflicting = holdConflicting;
exports.unwarnedMentions = unwarnedMentions;
exports.allergyCheckLine = allergyCheckLine;
exports.restrictionPrompt = restrictionPrompt;
const MEAT = 'chicken|beef|pork|bacon|\\bham\\b|sausage|pepperoni|salami|prosciutto|chorizo|lamb|turkey|steak|brisket|carnitas|barbacoa|meatball|big mac|mcnugget|tonkotsu|veal|duck';
const FISH = 'fish|salmon|tuna|\\bcod\\b|anchov|sardine|trout|tilapia|halibut|mackerel|sashimi|nigiri|caesar|bonito';
const SHELLFISH = 'shrimp|prawn|crab|lobster|scallop|\\bclams?\\b|mussel|oyster|crawfish|crayfish|scampi|california roll';
const EGG = '\\beggs?\\b|omelet|frittata|quiche|mayo|carbonara|aioli|custard|meringue|shakshuka';
const DAIRY = '\\bmilk|cheese|butter|cream|yogh?urt|paneer|ghee|alfredo|queso|latte|cappuccino|pizza|lasagn|margherita|tikka masala|mac and cheese|mozzarella|parmesan|feta';
/** The allergens and diets checked, with the dishes that usually carry each. */
const RULES = [
    { id: 'peanut', label: 'peanuts', contains: 'peanuts', examples: 'Pad Thai, satay, kung pao, gado gado, massaman curry, dan dan noodles, mole', named: /peanut|groundnut/, dishes: /peanut|groundnut|satay|pad thai|kung pao|gado.gado|massaman|dan dan|\bmole\b/ },
    { id: 'tree-nut', label: 'tree nuts', contains: 'tree nuts', examples: 'pesto, korma, baklava, praline, marzipan', named: /tree.?nut|almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia/, dishes: /almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|pesto|praline|baklava|marzipan|korma|nutella/ },
    { id: 'shellfish', label: 'shellfish', contains: 'shellfish', examples: 'shrimp, crab, lobster, scampi, California roll', named: /shellfish|shrimp|prawn|crab|lobster/, dishes: new RegExp(`shellfish|${SHELLFISH}`) },
    { id: 'fish', label: 'fish', contains: 'fish', examples: 'salmon, tuna, sashimi, Caesar salad (anchovy)', named: /\bfish\b/, dishes: new RegExp(FISH) },
    { id: 'egg', label: 'eggs', contains: 'eggs', examples: 'omelet, quiche, carbonara, aioli, mayonnaise', named: /\beggs?\b/, dishes: new RegExp(EGG) },
    { id: 'dairy', label: 'dairy', contains: 'dairy', examples: 'cheese, cream sauces, pizza, lasagna, tikka masala, paneer', named: /dairy|lactose|\bmilk\b/, dishes: new RegExp(DAIRY) },
    { id: 'gluten', label: 'gluten', contains: 'gluten', examples: 'bread, pasta, pizza, burgers, ramen, udon, tempura, dumplings', named: /gluten|wheat|celiac|coeliac/, dishes: /wheat|gluten|bread|pasta|spaghetti|pizza|burger|bun\b|burrito|sandwich|ramen|udon|seitan|tempura|dumpling|croissant|bagel|couscous|barley|flour/ },
    { id: 'soy', label: 'soy', contains: 'soy', examples: 'tofu, edamame, miso, teriyaki', named: /\bsoy|soya/, dishes: /\bsoy|tofu|edamame|tempeh|miso|teriyaki/ },
    { id: 'sesame', label: 'sesame', contains: 'sesame', examples: 'hummus, tahini, sesame noodles', named: /sesame|tahini/, dishes: /sesame|tahini|hummus|halva/ },
    { id: 'vegan', label: 'a vegan diet', contains: 'animal products', examples: 'meat, fish, eggs, dairy, honey', named: /\bvegan/, dishes: new RegExp(`${MEAT}|${FISH}|${SHELLFISH}|${EGG}|${DAIRY}|honey`), diet: true },
    { id: 'vegetarian', label: 'a vegetarian diet', contains: 'meat or fish', examples: 'chicken, beef, pork, fish, shrimp', named: /vegetarian/, dishes: new RegExp(`${MEAT}|${FISH}|${SHELLFISH}`), diet: true },
];
/** A text that states an allergy, an intolerance or a food the person avoids. */
const AVOIDS = /allerg|intoleran|anaphyla|epi-?pen|celiac|coeliac|can'?t (?:eat|have)|cannot (?:eat|have)|don'?t eat|do not eat|avoid|\bno\b|free\b|without/;
/** Words that mark a sentence as warning about an allergen rather than recommending a dish that has it in its name. */
const WARNS = /\b(?:contains?|avoid|has|made with|usually|allerg|warn|careful|cross[- ]?contam|not safe)/;
/**
 * @description The restrictions one text states: an allergen named in the same clause as an allergy or avoidance word
 * ("allergic to peanuts", "no shellfish"), generic nut phrasing ("nut allergy", "allergic to nuts", "tree nuts",
 * "no nuts") covering both peanuts and tree nuts, or a diet named outright ("vegan").
 * @param text - A saved note, a dietary entry or the diner's message.
 * @returns The rules it states.
 */
function rulesStated(text) {
    const found = [];
    const add = (rule) => { if (rule && !found.includes(rule))
        found.push(rule); };
    // Each clause on its own: "allergic to peanuts, but I love shrimp" restricts peanuts, not shrimp.
    for (const clause of String(text || '').toLowerCase().split(/[.;!?\n]+|,?\s+but\s+/)) {
        const avoids = AVOIDS.test(clause);
        if ((avoids && /\bnuts?\b/.test(clause)) || /\btree.?nuts?\b/.test(clause)) {
            add(RULES.find((r) => r.id === 'peanut'));
            add(RULES.find((r) => r.id === 'tree-nut'));
        }
        for (const rule of RULES)
            if (rule.named.test(clause) && (rule.diet || avoids))
                add(rule);
    }
    return found;
}
/**
 * @description The diner's restrictions from everything the route knows: this message, the saved concierge notes and the
 * profile's dietary list. A vegan diet already covers a vegetarian one, so only the stricter is kept.
 * @param sources - The texts to read (message, notes, dietary entries).
 * @returns Each restriction once.
 */
function dinerRestrictions(sources) {
    const found = new Map();
    for (const text of sources || [])
        for (const rule of rulesStated(String(text ?? '')))
            found.set(rule.id, rule);
    if (found.has('vegan'))
        found.delete('vegetarian');
    return RULES.filter((rule) => found.has(rule.id)).map(({ id, label, contains }) => ({ id, label, contains }));
}
/**
 * @description Whether a dish text says it is made without the allergen ("peanut-free", "no peanuts", "without nuts").
 * @param text - The lower-cased dish text.
 * @param rule - The restriction.
 * @returns True when the dish itself says the allergen is left out.
 */
function saysWithout(text, rule) {
    const named = rule.id === 'peanut' || rule.id === 'tree-nut' ? `${rule.named.source}|\\bnuts?\\b` : rule.named.source;
    return new RegExp(`(?:${named})[a-z]*[- ]free|(?:no|without|hold the) (?:${named})`).test(text)
        || (rule.diet === true && rule.named.test(text));
}
/**
 * @description The restrictions one dish conflicts with: its text names the allergen or a dish usually made with it,
 * unless it says it is made without it (a dish labelled vegan satisfies a vegan diet).
 * @param dish - The dish's text (title, and cuisine or description when known).
 * @param restrictions - The diner's restrictions.
 * @returns The conflicting restrictions.
 */
function dishConflicts(dish, restrictions) {
    const text = String(dish || '').toLowerCase();
    return (restrictions || []).filter((r) => {
        const rule = RULES.find((x) => x.id === r.id);
        return !!rule && rule.dishes.test(text) && !saysWithout(text, rule);
    });
}
/**
 * @description Split the search's dishes into the ones the concierge may offer and the ones held back for the diner's
 * restrictions. A held dish is never shown, offered or added.
 * @param candidates - The menu dishes from search.
 * @param restrictions - The diner's restrictions.
 * @returns The safe dishes and the held ones with their reason.
 */
function holdConflicting(candidates, restrictions) {
    const safe = [], held = [];
    for (const c of candidates || []) {
        const hit = dishConflicts(`${c?.title || ''} ${c?.description || ''}`, restrictions)[0];
        if (hit)
            held.push({ dish: String(c.title || ''), restriction: hit.id, label: hit.label, contains: hit.contains });
        else
            safe.push(c);
    }
    return { safe, held };
}
/**
 * @description Dishes the reply names that usually carry one of the diner's restrictions, in a sentence that does not
 * itself warn about that restriction (a sentence saying "Pad Thai usually contains peanuts" or "ask for it without
 * peanuts" already warns; "Try the Thai Peanut Noodles." does not). The route returns these as its own allergy-check
 * line beside the reply; the reply's words are left as the concierge wrote them.
 * @param reply - The concierge's reply.
 * @param restrictions - The diner's restrictions.
 * @returns One entry per unwarned dish mention.
 */
function unwarnedMentions(reply, restrictions) {
    const out = [];
    for (const sentence of String(reply || '').split(/(?<=[.!?])\s+|\n+/)) {
        const text = sentence.toLowerCase();
        for (const r of restrictions || []) {
            const rule = RULES.find((x) => x.id === r.id);
            if (!rule || (rule.named.test(text) && WARNS.test(text)) || saysWithout(text, rule))
                continue;
            const m = rule.dishes.exec(text);
            const dish = m ? sentence.slice(m.index, m.index + m[0].length) : '';
            if (dish && !out.some((o) => o.restriction === r.id && o.dish.toLowerCase() === dish.toLowerCase()))
                out.push({ dish, restriction: r.id, label: r.label, contains: r.contains });
        }
    }
    return out;
}
/**
 * @description The allergy-check line the surface shows under the reply, in words.
 * @param mentions - The unwarned dish mentions.
 * @returns The sentence, or '' when there is nothing to warn about.
 */
function allergyCheckLine(mentions) {
    if (!mentions.length)
        return '';
    const parts = mentions.map((m) => `${m.dish} usually contains ${m.contains} (you avoid ${m.label})`);
    return `Allergy and diet check: ${parts.join('; ')}. Ask the restaurant before ordering it.`;
}
/**
 * @description The restrictions block of the concierge's prompt: the facts it must apply to every dish it names.
 * @param restrictions - The diner's restrictions.
 * @param held - The dishes held back by the server.
 * @returns The prompt lines, or '' when the diner has none.
 */
function restrictionPrompt(restrictions, held) {
    if (!restrictions.length)
        return '';
    const lines = restrictions.map((r) => {
        const rule = RULES.find((x) => x.id === r.id);
        return `- ${r.label}: avoid dishes with ${r.contains}, such as ${rule ? rule.examples : r.contains}`;
    });
    const heldLine = held.length
        ? `\nHELD BACK BY THE SERVER for these restrictions (never offer, show or add them): ${held.map((h) => `${h.dish} (${h.label})`).join('; ')}`
        : '';
    return 'DINER ALLERGIES AND DIET (from this message, saved notes and the profile; apply to EVERY dish you name, from search or your own knowledge):\n'
        + `${lines.join('\n')}\nNever suggest a dish that contains one of these or is usually made with it (Pad Thai and satay usually contain peanuts). If you name such a dish at all, say in the same sentence what it usually contains and that the diner must ask for it without.${heldLine}`;
}
//# sourceMappingURL=allergen-check.js.map