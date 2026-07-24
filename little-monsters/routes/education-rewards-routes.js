"use strict";
/**
 * Education Rewards Routes — Little Monsters
 *
 * The collectible loot-box system. Leveling up (see awardXP in education-routes)
 * drops a mystery box; the student opens it in "My Monsters" (pick 1 of 3) and
 * wins a monster skin or an accessory, kept in their collection and equippable on
 * their avatar. Box opening is server-authoritative so the prize can't be spoofed.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-27 | roger.murphy@agenticfederal.us | Initial rewards/loot-box + collection system
 * ---------------------------------------------------------------------------
 * @module education-rewards-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REWARD_CATALOG = void 0;
exports.rollItem = rollItem;
exports.createEducationRewardsRoutes = createEducationRewardsRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-rewards-routes' });
exports.REWARD_CATALOG = [
    { id: 'mon-pink', type: 'monster', name: 'Pinky', rarity: 'common', hue: 0 },
    { id: 'mon-blue', type: 'monster', name: 'Bluebold', rarity: 'common', hue: 210 },
    { id: 'mon-teal', type: 'monster', name: 'Tealy', rarity: 'uncommon', hue: 160 },
    { id: 'mon-green', type: 'monster', name: 'Sprout', rarity: 'uncommon', hue: 120 },
    { id: 'mon-purple', type: 'monster', name: 'Grape', rarity: 'uncommon', hue: 270 },
    { id: 'mon-orange', type: 'monster', name: 'Tangelo', rarity: 'rare', hue: 330 },
    { id: 'mon-gold', type: 'monster', name: 'Goldie', rarity: 'rare', hue: 40, sat: 1.6 },
    { id: 'mon-rainbow', type: 'monster', name: 'Cosmo', rarity: 'legendary', hue: 0, rainbow: true },
    { id: 'acc-glasses', type: 'accessory', name: 'Smart Glasses', rarity: 'common', emoji: '👓', pos: 'eyes' },
    { id: 'acc-bow', type: 'accessory', name: 'Bow', rarity: 'common', emoji: '🎀', pos: 'top' },
    { id: 'acc-cap', type: 'accessory', name: 'Ball Cap', rarity: 'common', emoji: '🧢', pos: 'top' },
    { id: 'acc-flower', type: 'accessory', name: 'Flower', rarity: 'common', emoji: '🌸', pos: 'side' },
    { id: 'acc-shades', type: 'accessory', name: 'Cool Shades', rarity: 'uncommon', emoji: '🕶️', pos: 'eyes' },
    { id: 'acc-headphones', type: 'accessory', name: 'Headphones', rarity: 'uncommon', emoji: '🎧', pos: 'top' },
    { id: 'acc-scarf', type: 'accessory', name: 'Cozy Scarf', rarity: 'uncommon', emoji: '🧣', pos: 'side' },
    { id: 'acc-tophat', type: 'accessory', name: 'Top Hat', rarity: 'rare', emoji: '🎩', pos: 'top' },
    { id: 'acc-crown', type: 'accessory', name: 'Crown', rarity: 'rare', emoji: '👑', pos: 'top' },
    { id: 'acc-wizard', type: 'accessory', name: 'Wizard Hat', rarity: 'legendary', emoji: '🧙', pos: 'top' },
];
const RARITY_WEIGHT = { common: 60, uncommon: 25, rare: 12, legendary: 3 };
/** Weighted-random pick from the catalog (rarity-weighted). Exported for tests. */
function rollItem() {
    const total = exports.REWARD_CATALOG.reduce((s, it) => s + (RARITY_WEIGHT[it.rarity] || 1), 0);
    // Deterministic-enough randomness; Math.random is fine here (no replay concern).
    let r = Math.random() * total;
    for (const it of exports.REWARD_CATALOG) {
        r -= RARITY_WEIGHT[it.rarity] || 1;
        if (r <= 0)
            return it;
    }
    return exports.REWARD_CATALOG[0];
}
function createEducationRewardsRoutes(ctx) {
    const router = (0, express_1.Router)();
    // Self-contained table bootstrap (idempotent) — awardXP also writes `boxes` here.
    ctx.pool.query(`CREATE TABLE IF NOT EXISTS lm_rewards (
       student_id uuid PRIMARY KEY,
       boxes integer NOT NULL DEFAULT 0,
       inventory jsonb NOT NULL DEFAULT '[]'::jsonb,
       equipped jsonb NOT NULL DEFAULT '{}'::jsonb,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`).catch((err) => logger.warn({ err }, 'lm_rewards table bootstrap failed (non-fatal)'));
    async function loadState(studentId) {
        const r = await ctx.pool.query(`INSERT INTO lm_rewards (student_id) VALUES ($1)
       ON CONFLICT (student_id) DO UPDATE SET updated_at = NOW()
       RETURNING boxes, inventory, equipped`, [studentId]);
        const row = r.rows[0] || { boxes: 0, inventory: [], equipped: {} };
        return { boxes: row.boxes ?? 0, inventory: Array.isArray(row.inventory) ? row.inventory : [], equipped: row.equipped || {} };
    }
    /** GET /api/education/rewards — collection state + the catalog. */
    router.get('/rewards', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const st = await loadState(me.studentId);
            const prog = await ctx.pool.query('SELECT xp, level FROM lm_students WHERE student_id = $1', [me.studentId]);
            // The default pink monster is always owned so the avatar is never empty.
            const inventory = Array.from(new Set(['mon-pink', ...st.inventory]));
            res.json({
                boxes: st.boxes, inventory, equipped: st.equipped, catalog: exports.REWARD_CATALOG,
                xp: prog.rows[0]?.xp ?? 0, level: prog.rows[0]?.level ?? 1,
            });
        }
        catch (err) {
            logger.error({ err }, 'Failed to load rewards');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/rewards/open — spend a box, win an item (server-authoritative). */
    router.post('/rewards/open', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            // Spend the box ATOMICALLY: the `AND boxes > 0` guard + RETURNING is the whole
            // anti-cheat. Two concurrent opens can't both decrement past zero — only the row
            // whose decrement actually ran returns, so a student can never open more boxes
            // than they own (a read-then-write would let both requests pass the check).
            const dec = await ctx.pool.query(`UPDATE lm_rewards SET boxes = boxes - 1, updated_at = NOW()
         WHERE student_id = $1 AND boxes > 0 RETURNING boxes, inventory`, [me.studentId]);
            if (dec.rows.length === 0) {
                res.status(400).json({ error: 'No mystery boxes yet — earn XP and level up to win one!' });
                return;
            }
            const inventory = Array.isArray(dec.rows[0].inventory) ? dec.rows[0].inventory : [];
            const boxesLeft = dec.rows[0].boxes;
            const item = rollItem();
            const owned = inventory.includes(item.id);
            let bonusXp = 0;
            if (owned) {
                // Duplicate → a little sparkle bonus so a box is never a dud.
                bonusXp = 5;
                await ctx.pool.query('UPDATE lm_students SET xp = xp + 5 WHERE student_id = $1', [me.studentId]);
            }
            else {
                inventory.push(item.id);
                await ctx.pool.query('UPDATE lm_rewards SET inventory = $2::jsonb WHERE student_id = $1', [me.studentId, JSON.stringify(inventory)]);
            }
            res.json({ item, duplicate: owned, bonusXp, boxesLeft });
        }
        catch (err) {
            logger.error({ err }, 'Failed to open box');
            res.status(500).json({ error: 'Could not open the box' });
        }
    });
    /** POST /api/education/rewards/equip { itemId } — wear a monster skin or accessory. */
    router.post('/rewards/equip', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const itemId = String(req.body?.itemId || '');
            const st = await loadState(me.studentId);
            const equipped = st.equipped || {};
            if (itemId === 'none-accessory') {
                delete equipped.accessory;
            }
            else {
                const item = exports.REWARD_CATALOG.find((i) => i.id === itemId);
                if (!item) {
                    res.status(400).json({ error: 'Unknown item' });
                    return;
                }
                const owned = itemId === 'mon-pink' || st.inventory.includes(itemId);
                if (!owned) {
                    res.status(403).json({ error: 'You have not unlocked that yet' });
                    return;
                }
                equipped[item.type] = itemId; // 'monster' or 'accessory'
            }
            await ctx.pool.query(`UPDATE lm_rewards SET equipped = $2::jsonb, updated_at = NOW() WHERE student_id = $1`, [me.studentId, JSON.stringify(equipped)]);
            res.json({ equipped });
        }
        catch (err) {
            logger.error({ err }, 'Failed to equip');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=education-rewards-routes.js.map