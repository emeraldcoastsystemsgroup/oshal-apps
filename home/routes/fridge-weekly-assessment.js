"use strict";
// CHANGE LOG
// ----------------------------------------------------------------------------
// SEQ | AUTHOR | DESCRIPTION
// ----------------------------------------------------------------------------
// 1 | maintainer@emeraldcoastsystemsgroup.com | Weekly Samsung Family Hub refrigerator optical assessment, week-over-week shelf comparison, grocery cart recommendation & starter, and weekly meal list builder combining current fridge contents and order history.
// 2 | maintainer@emeraldcoastsystemsgroup.com | A temperature says when it was read (home 1.6.1). The state starts with 37 and 0 as placeholders, and the page showed them as readings ("Cooler: 37°F · Closed") for anyone whose hub had reported nothing. `telemetry.measuredAt` is null until a run is handed a temperature the hub reported, and is the time of that run afterwards; a state saved before this has none and counts as not read. The page shows a temperature only when it is set.
// ----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMealsForFocus = buildMealsForFocus;
exports.readFridgeWeeklyState = readFridgeWeeklyState;
exports.buildWeekOverWeekComparison = buildWeekOverWeekComparison;
exports.formatFridgeAssessmentResponse = formatFridgeAssessmentResponse;
exports.runWeeklyFridgeAssessment = runWeeklyFridgeAssessment;
exports.mutateFridgeMealAndCart = mutateFridgeMealAndCart;
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
function defaultCurrentItems() {
    return [
        { id: 'kraut-jar', name: 'Silver Floss Sauerkraut Jar', shelf: 'Top Shelf', category: 'Condiments & Ferments', quantity: '1 jar (~75% full)', status: 'stocked', daysInFridge: 14 },
        { id: 'pickles-olives', name: 'Dill Pickles & Olive Jars', shelf: 'Top Shelf', category: 'Condiments & Ferments', quantity: '2 jars', status: 'stocked', daysInFridge: 18 },
        { id: 'meal-prep-top', name: 'Stacked Meal-Prep Containers (Top)', shelf: 'Top Shelf', category: 'Prepared Meals', quantity: '2 containers', status: 'use-first', daysInFridge: 4 },
        { id: 'coffeemate', name: 'Coffee-mate Creamer (Blue Bottle / Red Cap)', shelf: 'Middle Shelf', category: 'Dairy & Creamer', quantity: '1 bottle (~25% left)', status: 'running-low', daysInFridge: 10 },
        { id: 'cold-brew', name: 'Dark Cold-Brew Coffee / Juice Bottle', shelf: 'Middle Shelf', category: 'Beverages', quantity: '1 carafe (~60% full)', status: 'stocked', daysInFridge: 5 },
        { id: 'meal-prep-glass', name: 'Glass Meal-Prep Chopped Salad & Protein Bowls', shelf: 'Middle Shelf', category: 'Prepared Meals', quantity: '2 glass bowls', status: 'use-first', daysInFridge: 3 },
        { id: 'bagged-salad', name: 'Bagged Salad Greens Mix', shelf: 'Bottom Shelf', category: 'Produce', quantity: '1 bag (opened)', status: 'use-first', daysInFridge: 5 },
        { id: 'fresh-berries', name: 'Fresh Blackberries & Blueberries Clamshells', shelf: 'Bottom Shelf', category: 'Produce', quantity: '2 clamshells', status: 'use-first', daysInFridge: 4 },
        { id: 'sliced-cheddar', name: 'Sliced Sharp Cheddar Cheese', shelf: 'Bottom Shelf', category: 'Dairy & Deli', quantity: '1 pack (~4 slices left)', status: 'running-low', daysInFridge: 9 },
    ];
}
function defaultPreviousWeekItems() {
    return [
        { name: 'Organic Whole Milk (Half Gallon)', shelf: 'Middle Shelf', statusLastWeek: 'Full jug', statusNow: 'Depleted (0 left)' },
        { name: 'Pasture-Raised Large Eggs (12 ct)', shelf: 'Middle Shelf', statusLastWeek: '10 eggs', statusNow: 'Depleted (0 left)' },
        { name: 'Grilled Chicken Breast Strips (16 oz)', shelf: 'Bottom Shelf', statusLastWeek: 'Full pack (used in meal prep)', statusNow: 'Depleted (raw pack gone)' },
        { name: 'Plain Greek Yogurt Tub (32 oz)', shelf: 'Middle Shelf', statusLastWeek: 'Half tub', statusNow: 'Depleted (0 left)' },
        { name: 'Coffee-mate Creamer (Blue Bottle / Red Cap)', shelf: 'Middle Shelf', statusLastWeek: 'Full bottle', statusNow: 'Running low (~25% left)' },
        { name: 'Sliced Sharp Cheddar Cheese', shelf: 'Bottom Shelf', statusLastWeek: 'Full 12-slice pack', statusNow: 'Running low (~4 slices left)' },
        { name: 'Fresh Blackberries & Blueberries Clamshells', shelf: 'Bottom Shelf', statusLastWeek: 'Freshly stocked (2 clamshells)', statusNow: 'Use first (4 days in fridge)' },
        { name: 'Bagged Salad Greens Mix', shelf: 'Bottom Shelf', statusLastWeek: 'Unopened bag', statusNow: 'Use first (opened · 5 days in fridge)' },
    ];
}
function defaultOrderHistory() {
    return [
        { id: 'ord-milk', name: 'Organic Whole Milk (Half Gallon)', category: 'Dairy & Eggs', lastOrderedDaysAgo: 7, typicalCadenceDays: 7, statusInFridge: 'depleted' },
        { id: 'ord-eggs', name: 'Pasture-Raised Large Eggs (12 ct)', category: 'Dairy & Eggs', lastOrderedDaysAgo: 7, typicalCadenceDays: 7, statusInFridge: 'depleted' },
        { id: 'ord-chicken', name: 'Grilled Chicken Breast Strips (16 oz)', category: 'Protein', lastOrderedDaysAgo: 7, typicalCadenceDays: 7, statusInFridge: 'depleted' },
        { id: 'ord-yogurt', name: 'Plain Greek Yogurt (32 oz)', category: 'Dairy & Eggs', lastOrderedDaysAgo: 10, typicalCadenceDays: 10, statusInFridge: 'depleted' },
        { id: 'ord-creamer', name: 'Coffee-mate Creamer (32 oz)', category: 'Dairy & Creamer', lastOrderedDaysAgo: 10, typicalCadenceDays: 14, statusInFridge: 'running-low' },
        { id: 'ord-cheddar', name: 'Sliced Sharp Cheddar Cheese (8 oz)', category: 'Dairy & Deli', lastOrderedDaysAgo: 9, typicalCadenceDays: 10, statusInFridge: 'running-low' },
        { id: 'ord-bread', name: 'Artisan Sourdough Bread Loaf', category: 'Bakery', lastOrderedDaysAgo: 7, typicalCadenceDays: 7, statusInFridge: 'depleted' },
        { id: 'ord-berries', name: 'Fresh Blackberries & Blueberries', category: 'Produce', lastOrderedDaysAgo: 4, typicalCadenceDays: 7, statusInFridge: 'stocked' },
        { id: 'ord-salad', name: 'Bagged Salad Greens Mix', category: 'Produce', lastOrderedDaysAgo: 5, typicalCadenceDays: 7, statusInFridge: 'stocked' },
    ];
}
function defaultCartItems() {
    return [
        { id: 'cart-eggs', name: 'Pasture-Raised Large Eggs (12 ct)', quantity: '1 dozen', category: 'Dairy & Eggs', reason: 'Depleted since last week · ordered weekly', priority: 'high', inCart: true },
        { id: 'cart-milk', name: 'Organic Whole Milk (Half Gallon)', quantity: '1 half-gallon', category: 'Dairy & Eggs', reason: 'Depleted since last week · ordered weekly', priority: 'high', inCart: true },
        { id: 'cart-creamer', name: 'Coffee-mate Creamer (32 oz)', quantity: '1 bottle', category: 'Dairy & Creamer', reason: 'Running low (~25% left on middle shelf)', priority: 'high', inCart: true },
        { id: 'cart-chicken', name: 'Grilled Chicken Breast / Meal-Prep Protein', quantity: '2 packs (32 oz)', category: 'Protein', reason: 'Restock protein to refill the 4 glass meal-prep containers', priority: 'high', inCart: true },
        { id: 'cart-cheddar', name: 'Sliced Sharp Cheddar Cheese', quantity: '1 pack (12 slices)', category: 'Dairy & Deli', reason: 'Running low (~4 slices left on bottom shelf)', priority: 'medium', inCart: true },
        { id: 'cart-yogurt', name: 'Plain Greek Yogurt (32 oz)', quantity: '1 tub', category: 'Dairy & Eggs', reason: 'Depleted · pairs with fresh blackberries & blueberries on bottom shelf', priority: 'medium', inCart: true },
        { id: 'cart-sourdough', name: 'Artisan Sourdough Bread Loaf', quantity: '1 loaf', category: 'Bakery', reason: 'Weekly staple for cheddar & sauerkraut melts', priority: 'medium', inCart: false },
    ];
}
function buildMealsForFocus(focus) {
    const mode = String(focus || 'use-first').toLowerCase();
    const base = [
        { id: 'meal-1', day: 'Day 1 (Tonight · Eat First)', mealType: 'Dinner', title: 'Prepped Glass-Bowl Chopped Salad & Protein with Dill Pickles', usesFromFridge: ['Glass Meal-Prep Chopped Salad & Protein Bowls (Middle Shelf)', 'Bagged Salad Greens Mix (Bottom Shelf)', 'Dill Pickles & Olive Jars (Top Shelf)'], usesFromOrdersOrCart: [], prepTimeMin: 5, notes: 'Zero-cook priority: finishes the 3-day-old glass meal-prep bowls and opened bagged salad while crisp.' },
        { id: 'meal-2', day: 'Day 2 (Morning & Lunch)', mealType: 'Breakfast & Lunch', title: 'Blackberry-Blueberry Yogurt Bowl + Cold-Brew with Coffee-mate', usesFromFridge: ['Fresh Blackberries & Blueberries Clamshells (Bottom Shelf)', 'Dark Cold-Brew Coffee (Middle Shelf)', 'Coffee-mate Creamer (Middle Shelf)'], usesFromOrdersOrCart: ['Plain Greek Yogurt (32 oz)'], prepTimeMin: 5, notes: 'Uses the fresh berry clamshells on the bottom shelf before they soften.' },
        { id: 'meal-3', day: 'Day 3 (Dinner)', mealType: 'Dinner', title: 'Warm Sharp Cheddar, Silver Floss Sauerkraut & Chicken Reuben Melt', usesFromFridge: ['Silver Floss Sauerkraut Jar (Top Shelf)', 'Sliced Sharp Cheddar Cheese (Bottom Shelf)', 'Dill Pickles & Olive Jars (Top Shelf)'], usesFromOrdersOrCart: ['Artisan Sourdough Bread Loaf', 'Grilled Chicken Breast / Meal-Prep Protein'], prepTimeMin: 15, notes: 'Pairs top-shelf Silver Floss sauerkraut and bottom-shelf cheddar with ordered sourdough and chicken.' },
        { id: 'meal-4', day: 'Day 4 (Lunch / Dinner)', mealType: 'Dinner', title: 'Harvest Berry, Cheddar & Grilled Chicken Bistro Salad', usesFromFridge: ['Bagged Salad Greens Mix (Bottom Shelf)', 'Fresh Blackberries & Blueberries Clamshells (Bottom Shelf)', 'Sliced Sharp Cheddar Cheese (Bottom Shelf)'], usesFromOrdersOrCart: ['Grilled Chicken Breast / Meal-Prep Protein'], prepTimeMin: 12, notes: 'Finishes the remaining bagged greens and berries with restocked chicken protein.' },
        { id: 'meal-5', day: 'Day 5 (Weekend Prep)', mealType: 'Brunch & Meal Prep', title: 'Pasture-Raised Egg, Cheddar & Kraut Scramble + 4-Container Weekly Prep', usesFromFridge: ['Silver Floss Sauerkraut Jar (Top Shelf)', 'Stacked Meal-Prep Containers (Top & Middle Shelves)'], usesFromOrdersOrCart: ['Pasture-Raised Large Eggs (12 ct)', 'Organic Whole Milk (Half Gallon)', 'Grilled Chicken Breast / Meal-Prep Protein'], prepTimeMin: 25, notes: 'Refills the top and middle shelf meal-prep containers for the upcoming week.' },
    ];
    if (mode.includes('protein')) {
        base[0].title = 'Double-Protein Chopped Salad Bowl with Cheddar & Pickles';
        base[1].notes = 'High-protein focus: 25g+ protein from Greek yogurt + berries.';
    }
    else if (mode.includes('quick')) {
        base.forEach((m) => { m.prepTimeMin = Math.min(m.prepTimeMin, 10); });
    }
    return base;
}
function buildDefaultState() {
    const now = new Date();
    const prev = new Date(now.getTime() - 7 * 86400000);
    return {
        version: 1,
        deviceId: '54cc0431-88bc-7a3e-c495-07a2a0be8571',
        deviceName: 'Samsung Family Hub Refrigerator',
        companionDependency: {
            app: 'phone-control',
            status: 'declared-optional',
            phoneDeviceId: 'c226d1d1-f827-4482-88ad-efc7fead5b5a',
            description: 'Captures 3-bay optical ViewInside shelf images via enrolled Samsung phone companion and SmartThings API.',
        },
        weeklySchedule: {
            enabled: true,
            cadence: 'weekly',
            dayOfWeek: 'Sunday',
            time: '09:00',
            cron: '0 9 * * 0',
            lastRunAt: now.toISOString(),
            nextRunAt: computeNextRunIso('Sunday', '09:00'),
        },
        telemetry: { coolerTempF: 37, freezerTempF: 0, measuredAt: null, doorStatus: 'closed', cameraZones: 3, imageUrl: '/api/home/fridge-image' },
        currentSnapshot: { capturedAt: now.toISOString(), items: defaultCurrentItems() },
        previousWeekSnapshot: { capturedAt: prev.toISOString(), items: defaultPreviousWeekItems() },
        orderHistory: defaultOrderHistory(),
        cart: { status: 'recommended', store: 'Weekly Grocery Cart', startedAt: null, updatedAt: now.toISOString(), items: defaultCartItems() },
        mealPlan: { focus: 'use-first', updatedAt: now.toISOString(), entries: buildMealsForFocus('use-first') },
    };
}
function readFridgeWeeklyState(sub) {
    const saved = (0, home_local_swarm_1.readPersistedJson)(sub, STATE_FILE);
    if (saved && saved.currentSnapshot && Array.isArray(saved.currentSnapshot.items)) {
        return saved;
    }
    const seeded = buildDefaultState();
    (0, home_local_swarm_1.writePersistedJson)(sub, STATE_FILE, seeded);
    return seeded;
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
    const summaryText = `Compared against last week's refrigerator scan: ${depletedFromLastWeek.length} weekly staples are depleted ` +
        `(${depletedFromLastWeek.map((d) => d.name).join(', ')}), ${runningLow.length} items are running low ` +
        `(${runningLow.map((r) => r.name).join(', ')}), and ${useFirst.length} fresh/prepped items should be eaten first ` +
        `(${useFirst.map((u) => u.name).join(', ')}).`;
    return { summaryText, depletedFromLastWeek, runningLow, useFirst, stillStocked, byShelf };
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
    state.currentSnapshot.capturedAt = nowIso;
    if (opts?.focus) {
        state.mealPlan.focus = opts.focus;
        state.mealPlan.entries = buildMealsForFocus(opts.focus);
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
        state.mealPlan.entries = buildMealsForFocus(focus);
        if (body.customMeal && typeof body.customMeal === 'object') {
            const cm = body.customMeal;
            const title = String(cm.title || '').trim();
            if (title) {
                state.mealPlan.entries.unshift({
                    id: `meal-custom-${Date.now()}`,
                    day: String(cm.day || 'Custom Meal').trim(),
                    mealType: String(cm.mealType || 'Dinner').trim(),
                    title,
                    usesFromFridge: Array.isArray(cm.usesFromFridge) ? cm.usesFromFridge.map(String) : ['Current fridge items'],
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
