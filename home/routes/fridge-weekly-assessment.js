"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTHING_READ = void 0;
exports.buildMealsForFocus = buildMealsForFocus;
exports.readFridgeWeeklyState = readFridgeWeeklyState;
exports.buildWeekOverWeekComparison = buildWeekOverWeekComparison;
exports.formatFridgeAssessmentResponse = formatFridgeAssessmentResponse;
exports.runWeeklyFridgeAssessment = runWeeklyFridgeAssessment;
exports.mutateFridgeMealAndCart = mutateFridgeMealAndCart;
// CHANGE LOG
// ----------------------------------------------------------------------------
// SEQ | AUTHOR | DESCRIPTION
// ----------------------------------------------------------------------------
// 1 | maintainer@emeraldcoastsystemsgroup.com | Weekly Samsung Family Hub refrigerator optical assessment, week-over-week shelf comparison, grocery cart recommendation & starter, and weekly meal list builder combining current fridge contents and order history.
// 2 | maintainer@emeraldcoastsystemsgroup.com | A temperature says when it was read (home 1.6.1). The state starts with 37 and 0 as placeholders, and the page showed them as readings ("Cooler: 37°F · Closed") for anyone whose hub had reported nothing. `telemetry.measuredAt` is null until a run is handed a temperature the hub reported, and is the time of that run afterwards; a state saved before this has none and counts as not read. The page shows a temperature only when it is set.
// 3 | maintainer@emeraldcoastsystemsgroup.com | Nothing is listed until the refrigerator's inside has really been read (home 1.6.2). Every person's state used to start from one fixed list: nine items on three shelves, eight changes since "last week", an order history, a grocery list and five meals, shown as their own refrigerator, with one household's device ids written in. That list is gone. A state starts empty and says so (NOTHING_READ); a state saved from the fixed list is carried over keeping only what the person set or added themselves (the schedule, a temperature the hub reported, items they added to the list, orders they logged, meals they wrote); a run no longer claims a capture time; meal ideas exist only from a reading. Guard: tests/home-device-inspect-and-guide.test.js fails if the route source carries an item again.
// ----------------------------------------------------------------------------
const home_local_swarm_1 = require("./home-local-swarm");
const STATE_FILE = 'fridge-weekly-state.json';
function computeNextRunIso(dayOfWeek, timeStr) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDay = Math.max(0, days.findIndex((d) => d.toLowerCase() === String(dayOfWeek || 'Sunday').toLowerCase()));
    const [hh, mm] = String(timeStr || '09:00').split(':').map((n) => Number(n) || 0);
    const now = new Date();
    const next = new Date(now.getTime());
    const diff = (targetDay - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + diff);
    next.setHours(hh, mm, 0, 0);
    return next.toISOString();
}
/** The state's shape. 2 (home 1.6.2): nothing is listed until the refrigerator's inside has really been read. */
const STATE_VERSION = 2;
/** The reason the route gives an item a person adds to their list themselves; it tells their items in a state kept from version 1. */
const ADDED_BY_PERSON = 'Added for weekly meal plan';
/** What the page and the assistant say while no reading exists. */
exports.NOTHING_READ = 'Nothing has been read from this refrigerator yet, so there is no list of what is inside, no comparison with last week and no meal ideas. Reading the inside photos is not built yet.';
/**
 * @description Meal ideas for a focus. They come from a reading of what is inside; no reading exists yet, so there are none.
 * @param _focus The focus a person chose (kept with their plan for when readings exist).
 * @returns No ideas.
 */
function buildMealsForFocus(_focus) {
    return [];
}
/**
 * @description A person's refrigerator state before anything was read: the weekly check's settings and empty lists.
 * @returns The empty state.
 */
function buildDefaultState() {
    const now = new Date().toISOString();
    return {
        version: STATE_VERSION,
        deviceId: '',
        deviceName: 'Refrigerator',
        companionDependency: {
            app: 'phone-control',
            status: 'declared-optional',
            phoneDeviceId: '',
            description: 'The inside photos come from the refrigerator through the person\'s own SmartThings connection.',
        },
        weeklySchedule: {
            enabled: true,
            cadence: 'weekly',
            dayOfWeek: 'Sunday',
            time: '09:00',
            cron: '0 9 * * 0',
            lastRunAt: null,
            nextRunAt: computeNextRunIso('Sunday', '09:00'),
        },
        telemetry: { coolerTempF: 37, freezerTempF: 0, measuredAt: null, doorStatus: 'closed', cameraZones: 3, imageUrl: '/api/home/fridge-image' },
        currentSnapshot: { capturedAt: null, items: [] },
        previousWeekSnapshot: { capturedAt: null, items: [] },
        orderHistory: [],
        cart: { status: 'recommended', store: 'Weekly Grocery Cart', startedAt: null, updatedAt: now, items: [] },
        mealPlan: { focus: 'use-first', updatedAt: now, entries: [] },
    };
}
/**
 * @description Carry over a state saved before 1.6.2. Its shelves, comparison, order history, grocery list and meals were
 * one fixed list given to everyone, so they are dropped; what the person set or added themselves is kept: the weekly
 * check's settings, a temperature the hub reported, items they added to the list (told by the reason the route gave
 * them), orders they logged and meals they wrote (told by the ids the route gave them).
 * @param saved The saved state.
 * @returns The state in the current shape.
 */
function carriedOver(saved) {
    const fresh = buildDefaultState();
    if (saved.weeklySchedule) {
        fresh.weeklySchedule.enabled = saved.weeklySchedule.enabled !== false;
        if (saved.weeklySchedule.dayOfWeek)
            fresh.weeklySchedule.dayOfWeek = saved.weeklySchedule.dayOfWeek;
        if (saved.weeklySchedule.time)
            fresh.weeklySchedule.time = saved.weeklySchedule.time;
        fresh.weeklySchedule.nextRunAt = computeNextRunIso(fresh.weeklySchedule.dayOfWeek, fresh.weeklySchedule.time);
    }
    if (saved.telemetry && saved.telemetry.measuredAt) {
        fresh.telemetry = { ...fresh.telemetry, coolerTempF: saved.telemetry.coolerTempF, freezerTempF: saved.telemetry.freezerTempF, measuredAt: saved.telemetry.measuredAt };
    }
    const own = ((saved.cart && saved.cart.items) || []).filter((item) => item.reason === ADDED_BY_PERSON);
    fresh.cart.items = own;
    if (own.length && saved.cart.status === 'active') {
        fresh.cart.status = 'active';
        fresh.cart.startedAt = saved.cart.startedAt;
    }
    fresh.orderHistory = (saved.orderHistory || []).filter((order) => /^ord-\d{10,}$/.test(order.id));
    fresh.mealPlan.entries = ((saved.mealPlan && saved.mealPlan.entries) || []).filter((meal) => /^meal-custom-\d+$/.test(meal.id));
    if (saved.mealPlan && saved.mealPlan.focus)
        fresh.mealPlan.focus = saved.mealPlan.focus;
    return fresh;
}
/**
 * @description A person's refrigerator state: the saved one in the current shape, a saved one from before 1.6.2 carried
 * over, or the empty one. What is returned is also what is kept.
 * @param sub The person.
 * @returns The state.
 */
function readFridgeWeeklyState(sub) {
    const saved = (0, home_local_swarm_1.readPersistedJson)(sub, STATE_FILE);
    if (saved && saved.version === STATE_VERSION && saved.currentSnapshot && Array.isArray(saved.currentSnapshot.items)) {
        return saved;
    }
    const next = saved && saved.currentSnapshot ? carriedOver(saved) : buildDefaultState();
    (0, home_local_swarm_1.writePersistedJson)(sub, STATE_FILE, next);
    return next;
}
function buildWeekOverWeekComparison(state) {
    const items = state.currentSnapshot.items || [];
    const useFirst = items.filter((i) => i.status === 'use-first');
    const runningLow = items.filter((i) => i.status === 'running-low');
    const stillStocked = items.filter((i) => i.status === 'stocked');
    const depletedFromLastWeek = (state.previousWeekSnapshot.items || []).filter((p) => /depleted/i.test(p.statusNow));
    const byShelf = {
        topShelf: items.filter((i) => i.shelf === 'Top Shelf'),
        middleShelf: items.filter((i) => i.shelf === 'Middle Shelf'),
        bottomShelf: items.filter((i) => i.shelf === 'Bottom Shelf'),
    };
    // Read: the inside was really read and something was seen. Until then every list is empty and the words say why.
    const read = Boolean(state.currentSnapshot.capturedAt) && items.length > 0;
    const summaryText = !read ? exports.NOTHING_READ :
        `Compared against last week's refrigerator scan: ${depletedFromLastWeek.length} weekly staples are depleted ` +
            `(${depletedFromLastWeek.map((d) => d.name).join(', ')}), ${runningLow.length} items are running low ` +
            `(${runningLow.map((r) => r.name).join(', ')}), and ${useFirst.length} fresh/prepped items should be eaten first ` +
            `(${useFirst.map((u) => u.name).join(', ')}).`;
    return { read, summaryText, depletedFromLastWeek, runningLow, useFirst, stillStocked, byShelf };
}
function formatFridgeAssessmentResponse(sub) {
    const state = readFridgeWeeklyState(sub);
    const comparison = buildWeekOverWeekComparison(state);
    const activeCartCount = (state.cart.items || []).filter((i) => i.inCart).length;
    return {
        ok: true,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        companionDependency: state.companionDependency,
        weeklySchedule: state.weeklySchedule,
        telemetry: state.telemetry,
        currentSnapshot: state.currentSnapshot,
        previousWeekSnapshot: state.previousWeekSnapshot,
        orderHistory: state.orderHistory,
        comparison,
        reading: { read: comparison.read, capturedAt: state.currentSnapshot.capturedAt, words: comparison.read ? '' : exports.NOTHING_READ },
        cart: { ...state.cart, activeItemCount: activeCartCount },
        mealPlan: state.mealPlan,
    };
}
function runWeeklyFridgeAssessment(sub, opts) {
    const state = readFridgeWeeklyState(sub);
    const nowIso = new Date().toISOString();
    state.weeklySchedule.lastRunAt = nowIso;
    state.weeklySchedule.nextRunAt = computeNextRunIso(state.weeklySchedule.dayOfWeek, state.weeklySchedule.time);
    if (typeof opts?.coolerTempF === 'number')
        state.telemetry.coolerTempF = opts.coolerTempF;
    if (typeof opts?.freezerTempF === 'number')
        state.telemetry.freezerTempF = opts.freezerTempF;
    if (typeof opts?.coolerTempF === 'number' || typeof opts?.freezerTempF === 'number')
        state.telemetry.measuredAt = nowIso;
    state.telemetry.imageUrl = `/api/home/fridge-image?t=${Date.now()}`;
    // A run reads the hub's temperature and nothing inside: it sets no capture time and makes no meal.
    if (opts?.focus) {
        state.mealPlan.focus = opts.focus;
        state.mealPlan.updatedAt = nowIso;
    }
    (0, home_local_swarm_1.writePersistedJson)(sub, STATE_FILE, state);
    return formatFridgeAssessmentResponse(sub);
}
function applyCartMutation(state, action, body, nowIso) {
    if (action === 'start-cart') {
        state.cart.status = 'active';
        state.cart.startedAt = nowIso;
        state.cart.updatedAt = nowIso;
        if (typeof body.store === 'string' && body.store.trim())
            state.cart.store = body.store.trim();
        state.cart.items.forEach((item) => { if (item.priority === 'high' || item.priority === 'medium')
            item.inCart = true; });
    }
    else if (action === 'toggle-cart-item') {
        const target = String(body.id || body.name || '').trim().toLowerCase();
        const found = state.cart.items.find((i) => i.id.toLowerCase() === target || i.name.toLowerCase().includes(target));
        if (found) {
            found.inCart = typeof body.inCart === 'boolean' ? body.inCart : !found.inCart;
            state.cart.updatedAt = nowIso;
        }
    }
    else if (action === 'add-cart-item') {
        const name = String(body.name || '').trim();
        if (!name)
            return;
        const id = 'cart-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
        const existing = state.cart.items.find((i) => i.id === id || i.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            existing.inCart = true;
            if (typeof body.quantity === 'string' && body.quantity.trim())
                existing.quantity = body.quantity.trim();
        }
        else {
            state.cart.items.push({ id, name, quantity: String(body.quantity || '1 item').trim(), category: String(body.category || 'Grocery').trim(), reason: String(body.reason || 'Added for weekly meal plan').trim(), priority: 'high', inCart: true });
        }
        state.cart.updatedAt = nowIso;
    }
    else if (action === 'remove-cart-item') {
        const target = String(body.id || body.name || '').trim().toLowerCase();
        state.cart.items = state.cart.items.filter((i) => i.id.toLowerCase() !== target && !i.name.toLowerCase().includes(target));
        state.cart.updatedAt = nowIso;
    }
}
function mutateFridgeMealAndCart(sub, body) {
    const state = readFridgeWeeklyState(sub);
    const action = String(body.action || 'start-cart').trim().toLowerCase();
    const nowIso = new Date().toISOString();
    if (action.includes('cart')) {
        applyCartMutation(state, action, body, nowIso);
    }
    else if (action === 'build-meal-list') {
        const focus = String(body.focus || state.mealPlan.focus || 'use-first').trim();
        state.mealPlan.focus = focus;
        // Ideas come from a reading; the meals a person wrote themselves stay.
        state.mealPlan.entries = [...buildMealsForFocus(focus), ...state.mealPlan.entries.filter((meal) => /^meal-custom-\d+$/.test(meal.id))];
        if (body.customMeal && typeof body.customMeal === 'object') {
            const cm = body.customMeal;
            const title = String(cm.title || '').trim();
            if (title) {
                state.mealPlan.entries.unshift({
                    id: `meal-custom-${Date.now()}`,
                    day: String(cm.day || 'Custom Meal').trim(),
                    mealType: String(cm.mealType || 'Dinner').trim(),
                    title,
                    usesFromFridge: Array.isArray(cm.usesFromFridge) ? cm.usesFromFridge.map(String) : [],
                    usesFromOrdersOrCart: Array.isArray(cm.usesFromOrdersOrCart) ? cm.usesFromOrdersOrCart.map(String) : [],
                    prepTimeMin: Number(cm.prepTimeMin) || 15,
                    notes: String(cm.notes || 'Custom meal added to weekly plan').trim(),
                });
            }
        }
        state.mealPlan.updatedAt = nowIso;
    }
    else if (action === 'log-order') {
        const name = String(body.name || '').trim();
        if (name) {
            state.orderHistory.unshift({ id: `ord-${Date.now()}`, name, category: String(body.category || 'Grocery').trim(), lastOrderedDaysAgo: 0, typicalCadenceDays: Number(body.typicalCadenceDays) || 7, statusInFridge: 'stocked' });
        }
    }
    else if (action === 'set-weekly-schedule') {
        if (typeof body.enabled === 'boolean')
            state.weeklySchedule.enabled = body.enabled;
        if (typeof body.dayOfWeek === 'string' && body.dayOfWeek.trim())
            state.weeklySchedule.dayOfWeek = body.dayOfWeek.trim();
        if (typeof body.time === 'string' && body.time.trim())
            state.weeklySchedule.time = body.time.trim();
        state.weeklySchedule.nextRunAt = computeNextRunIso(state.weeklySchedule.dayOfWeek, state.weeklySchedule.time);
    }
    (0, home_local_swarm_1.writePersistedJson)(sub, STATE_FILE, state);
    return formatFridgeAssessmentResponse(sub);
}
