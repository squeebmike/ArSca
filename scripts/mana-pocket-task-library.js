// Data only, no logic: the full Roles & Tasks starter set distilled from
// "The Mana Pocket Owner Roles and Operating Schedule" (the three-owner
// operating doc for Shawn/Sean/Jaccob). Read by the one-click importer in
// daily-tasks-dashboard.js (importManaPocketTasks) so a store doesn't have
// to hand-enter ~65 tasks -- it's kept in its own file/global rather than
// inline in that IIFE so the task list can be read and updated on its own.
//
// cadence matches daily_task_items.cadence ('daily'|'weekly'|'monthly'|
// 'quarterly'|'yearly'); daysOfWeek (0=Sun..6=Sat) only matters for
// 'daily'/'weekly' cadence tasks. Role "Any" is the open-to-anyone bucket
// -- not one of the three owners -- for duty-owner/whoever's-on-shift work.
window.MANA_POCKET_TASK_LIBRARY = {
  label: 'The Mana Pocket — Owner Roles & Operating Schedule',
  roles: ['Any', 'Shawn', 'Sean', 'Jaccob'],
  tasks: [
    // ── Daily: opening ──────────────────────────────────────────────
    { role: 'Any', title: 'Security & systems check', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Check alarms, cameras, doors, cases, high value inventory, work areas, and equipment.' },
    { role: 'Any', title: 'Open sales channels', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Open POS and sales channels. Confirm website, eBay, payment, printer, camera, and shipping systems are available.' },
    { role: 'Any', title: 'Review overnight activity', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Review orders, local pickups, messages, returns, disputes, cancellations, presales, and overdue customer follow ups.' },
    { role: 'Shawn', title: "Assign the day's duty roles", cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Review the task board and assign the duty owner, shipping owner, listing block, content item, and any live sale or event preparation.' },
    { role: 'Sean', title: "Post today's content", cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Post or schedule content only when there is something worth saying. Product facts must be verified by the category captain.' },
    // ── Daily: during the day ───────────────────────────────────────
    { role: 'Any', title: 'Receive inventory', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Receive into a pending state, match invoice quantities and costs, photograph damage, and have the category captain verify item identity before sale.' },
    { role: 'Any', title: 'List & shelve inventory', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Photograph, list, price, shelve, and locate inventory using the approved workflow. No sellable item lives in an untracked pile.' },
    { role: 'Any', title: 'Pack & ship paid orders', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Pack paid orders to standard, scan tracking, stage local pickups, and use a second check for high value shipments.' },
    { role: 'Sean', title: 'Clear the customer queue', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Answer customer messages in the shared queue. Record wants, preorders, holds, and sourcing requests in the customer request list.' },
    { role: 'Any', title: 'Record collection offers', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Record seller, purchase basis, comps, condition, seller information required by policy, and who approved the buy.' },
    { role: 'Any', title: 'Reset work areas', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Keep counters, sorting areas, camera stations, packing stations, and customer areas clean enough for the next person to work immediately.' },
    // ── Daily: closing ──────────────────────────────────────────────
    { role: 'Shawn', title: 'Reconcile the day', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Reconcile POS, cash, online orders, refunds, discounts, pickups, and shipments. Explain every variance the same day.' },
    { role: 'Any', title: 'Confirm sold items delisted', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Confirm sold items are removed from every channel and inventory locations are accurate.' },
    { role: 'Any', title: 'Secure the store', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Secure cash, high value items, customer property, keys, devices, shipping labels, and confidential records.' },
    { role: 'Any', title: 'Close customer loops', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Close open customer loops or leave a named handoff with the next action and deadline.' },
    { role: 'Any', title: 'End of day systems check', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Charge equipment, back up or sync required files, arm security, inspect doors, and record incidents or maintenance issues.' },
    // ── Daily numbers ───────────────────────────────────────────────
    { role: 'Any', title: 'Post daily sales numbers', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Post sales by channel and category. Shawn reviews exceptions.' },
    { role: 'Any', title: 'Report shipping status', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Report orders shipped and overdue.' },
    { role: 'Any', title: 'Report listing output', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Report listings created or improved.' },
    { role: 'Sean', title: 'Clear aged customer messages', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Clear any customer messages open over one business day.' },
    { role: 'Any', title: 'Report cash/inventory variance', cadence: 'daily', daysOfWeek: [0,1,2,3,4,5,6], detail: 'Report any cash or inventory variance immediately to Shawn.' },

    // ── Weekly ──────────────────────────────────────────────────────
    { role: 'Shawn', title: 'Weekly owner meeting', cadence: 'weekly', daysOfWeek: [1], detail: 'Twenty minute meeting: prior week scorecard, cash needs, blockers, deadlines, duty schedule. Agenda: numbers, customers, inventory, calendar, decisions (each with an owner and a deadline).' },
    { role: 'Sean', title: 'Review customer requests & drafts — comics/sports', cadence: 'weekly', daysOfWeek: [1], detail: 'Review customer requests, presales, holds, new releases, distributor deadlines, and comics/sports order drafts.' },
    { role: 'Jaccob', title: 'Review customer requests & drafts — Pokemon/MTG', cadence: 'weekly', daysOfWeek: [1], detail: 'Review customer requests, presales, holds, new releases, distributor deadlines, and Pokemon/MTG order drafts.' },
    { role: 'Shawn', title: 'Approve & submit FOC / wholesale orders', cadence: 'weekly', daysOfWeek: [1], detail: 'Approve and submit FOC and wholesale orders within the weekly purchasing budget, before each cutoff.' },
    { role: 'Any', title: 'Ship & audit sold inventory', cadence: 'weekly', daysOfWeek: [2,5], detail: 'Twice weekly: ship all paid orders, clear pickups, and audit sold inventory across channels.' },
    { role: 'Sean', title: 'Midweek price refresh — comics/sports/MTG merch', cadence: 'weekly', daysOfWeek: [3], detail: 'Price refresh for hot products and high value singles; review market drops and stale listings.' },
    { role: 'Jaccob', title: 'Midweek price refresh — Pokemon/MTG', cadence: 'weekly', daysOfWeek: [3], detail: 'Price refresh for hot products and high value singles; review market drops and stale listings.' },
    { role: 'Sean', title: 'Midweek content batch', cadence: 'weekly', daysOfWeek: [3], detail: 'Content batch for comics, sports, Pokemon, MTG live sales, events, and store progress.' },
    { role: 'Shawn', title: 'Cycle count one inventory zone', cadence: 'weekly', daysOfWeek: [5], detail: 'Cycle count one defined inventory zone and resolve every variance.' },
    { role: 'Shawn', title: 'Weekly financial review', cadence: 'weekly', daysOfWeek: [5], detail: 'Review sales, gross margin, sell-through, average order value, shipping cost, and marketplace fees.' },
    { role: 'Any', title: 'End of week reset', cadence: 'weekly', daysOfWeek: [5], detail: 'Clean and reset listing, packing, streaming, event, and customer areas; replenish supplies. Duty owner verifies.' },
    { role: 'Shawn', title: 'Weekly systems & backup review', cadence: 'weekly', daysOfWeek: [5], detail: 'Back up operating data and review failed automations, integrations, security alerts, and access changes.' },
    { role: 'Sean', title: 'Weekly category report — comics/sports/MTG', cadence: 'weekly', daysOfWeek: [1], detail: 'Five minutes: winners, missed demand, stale items, preorder risk, planned buys, merchandising changes.' },
    { role: 'Jaccob', title: 'Weekly category report — Pokemon/MTG', cadence: 'weekly', daysOfWeek: [1], detail: 'Five minutes: winners, allocation needs, singles activity, event interest, pricing changes, planned buys.' },
    { role: 'Shawn', title: 'Weekly ops report', cadence: 'weekly', daysOfWeek: [1], detail: 'Five minutes: cash runway, bills, purchase capacity, systems issues, fulfillment health, channel performance, company blockers.' },

    // ── Monthly ─────────────────────────────────────────────────────
    { role: 'Shawn', title: 'Close the month', cadence: 'monthly', detail: 'Reconcile sales, payouts, fees, refunds, shipping, purchases, bills, cash, and bank activity.' },
    { role: 'Shawn', title: 'Review profit & cash', cadence: 'monthly', detail: "Sales, gross profit, operating expenses, cash available, owner labor, and next month's buying limit." },
    { role: 'Sean', title: 'Monthly category business review — comics/sports', cadence: 'monthly', detail: "Sales, margin, sell-through, stockouts, stale inventory, and next month's release plan." },
    { role: 'Jaccob', title: 'Monthly category business review — Pokemon/MTG', cadence: 'monthly', detail: "Sales, margin, sell-through, stockouts, stale inventory, and next month's release plan." },
    { role: 'Sean', title: 'Monthly inventory cycle count — comics/sports', cadence: 'monthly', detail: 'Count all high value inventory plus one complete category or storage zone.' },
    { role: 'Jaccob', title: 'Monthly inventory cycle count — Pokemon/MTG', cadence: 'monthly', detail: 'Count all high value inventory plus one complete category or storage zone.' },
    { role: 'Sean', title: 'Marketplace audit', cadence: 'monthly', detail: 'Listing quality, late shipment, defects, cancellations, returns, feedback, and aged listings.' },
    { role: 'Shawn', title: 'Vendor statement review', cadence: 'monthly', detail: 'Invoices, credits, backorders, allocations, damaged goods, and outstanding claims reconciled.' },
    { role: 'Shawn', title: 'Supplies & equipment check', cadence: 'monthly', detail: 'Confirm a thirty day supply of mailers, sleeves, top loaders, labels, ink, cleaning, and event materials.' },
    { role: 'Jaccob', title: 'Marketing & event calendar', cadence: 'monthly', detail: 'Build a thirty to sixty day schedule with launches, streams, conventions, and community events (with Sean).' },
    { role: 'Shawn', title: 'Security & access review', cadence: 'monthly', detail: 'User access, camera, alarm, key, password manager, and device review; remove departed access immediately.' },
    { role: 'Any', title: 'Owner capacity review', cadence: 'monthly', detail: 'Hours worked, repeated bottlenecks, missed tasks, and the next process to automate, delegate, or hire.' },

    // ── Quarterly ───────────────────────────────────────────────────
    { role: 'Shawn', title: 'Quarterly owner review', cadence: 'quarterly', detail: 'Half day review comparing the quarter with budget, break even needs, cash targets, category goals, and channel goals.' },
    { role: 'Shawn', title: 'Wall-to-wall high-value inventory count', cadence: 'quarterly', detail: 'Count all high value inventory and rotate a complete count of remaining categories. Investigate shrink and repeated location errors.' },
    { role: 'Sean', title: 'Aged inventory liquidation plan', cadence: 'quarterly', detail: 'Build a markdown, bundle, auction, show, or liquidation plan for inventory past its age limit, with a deadline (Jaccob for TCG).' },
    { role: 'Shawn', title: 'Vendor & distributor review', cadence: 'quarterly', detail: 'Review distributor allocations, discount tiers, freight, payment terms, purchase concentration, damaged goods, and vendor performance.' },
    { role: 'Shawn', title: 'Test security & disaster readiness', cadence: 'quarterly', detail: "Test security, backups, account recovery, cameras, alarms, device access, incident response, and a backup owner's ability to run core systems." },
    { role: 'Shawn', title: 'Compliance review', cadence: 'quarterly', detail: 'Review licenses, reseller documentation, insurance coverage, sales tax calendar, event requirements, consumer policies, and records retention.' },
    { role: 'Shawn', title: 'Review ownership & workload', cadence: 'quarterly', detail: 'Review category ownership and workload. Reassign tasks that have become dependent on one person or are consistently missed.' },
    { role: 'Shawn', title: 'Set next quarter plan', cadence: 'quarterly', detail: "Set next quarter's launch calendar, event plan, buying budget, content plan, technology projects, and measurable targets." },

    // ── Yearly ──────────────────────────────────────────────────────
    { role: 'Shawn', title: 'Build the annual budget', cadence: 'yearly', detail: 'Create the annual budget, twelve month cash plan, monthly break even target, category budgets, capital purchases, and owner compensation or distribution plan.' },
    { role: 'Shawn', title: 'Year-end inventory count', cadence: 'yearly', detail: 'Complete the year end inventory count and valuation with documented adjustments, damaged inventory, personal use, giveaways, and obsolete stock.' },
    { role: 'Shawn', title: 'Prepare tax & accounting records', cadence: 'yearly', detail: 'Reconcile contractor payments, payroll if applicable, sales tax, marketplace reports, bank accounts, loans, and owner contributions.' },
    { role: 'Shawn', title: 'Renew licenses & accounts', cadence: 'yearly', detail: 'Renew business licenses, reseller documents, insurance, leases, domains, software, permits, and key vendor accounts before expiration.' },
    { role: 'Any', title: 'Review the operating agreement', cadence: 'yearly', detail: 'Review the operating agreement, decision rights, ownership expectations, buy sell provisions, signing authority, personal guarantees, and succession plan with qualified professionals.' },
    { role: 'Jaccob', title: 'Set the annual event calendar', cadence: 'yearly', detail: 'Set the annual release, convention, holiday, organized play, live selling, inventory, hiring, and marketing calendar (with Sean).' },
    { role: 'Shawn', title: 'Run a disaster recovery exercise', cadence: 'yearly', detail: 'Restore a backup, recover an account, produce an inventory export, and prove the business can operate if one owner is unavailable.' },
    { role: 'Any', title: 'Review every recurring process', cadence: 'yearly', detail: 'Keep what works, rewrite what fails, remove duplicate tools, and choose the next automation or hire based on saved owner hours.' },
  ],
};
