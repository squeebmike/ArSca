import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Inventory search must be debounced, not fired on every keystroke ────
// The inventory table itself is already paginated (PER=50), so it isn't
// re-rendering thousands of rows. The real per-keystroke cost is
// filterTable() -> smartSearchLocalItems(q, all, all.length), which maps
// and scores the ENTIRE inventory array on every call, then also
// re-renders the health/aging panels (also full-array walks). Typing a
// query used to redo all of that on every single keystroke.

assert.match(dashboard, /function debounce\(fn, waitMs\)\{/, 'missing shared debounce helper');
assert.match(dashboard, /const filterTableDebounced = debounce\(filterTable, 200\);/, 'inventory search must debounce filterTable, not call it directly');
assert.match(dashboard, /id="tbl-q"[^>]*oninput="filterTableDebounced\(\)"/, 'the inventory search box must call the debounced wrapper, not filterTable() directly');
assert.doesNotMatch(dashboard, /id="tbl-q"[^>]*oninput="filterTable\(\)"/, 'the inventory search box must not call filterTable() directly anymore');

// Non-typing callers (filter chips, sort clicks, voice search) must still
// get instant feedback -- they call filterTable() directly, unchanged.
assert.match(dashboard, /activeF = filter; page = 1; filterTable\(\);/, 'filter-chip clicks must still call filterTable() directly (no debounce) for instant feedback');
assert.match(dashboard, /function setComicInventorySort\(column\)\{ts2\.col=column\|\|'name';ts2\.dir=1;page=1;filterTable\(\);\}/, 'sort-column clicks must still call filterTable() directly (no debounce)');

console.log('Inventory search debounce contract checks passed');

// ── Functional check: debounce() itself ──────────────────────────────
{
  const src = dashboard.match(/function debounce\(fn, waitMs\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract debounce for functional testing');

  await new Promise((resolve, reject) => {
    try {
      const debounce = new Function(`${src}\nreturn debounce;`)();
      let calls = 0;
      const fn = debounce(() => { calls++; }, 20);
      fn(); fn(); fn();
      assert.equal(calls, 0, 'debounce must not call the wrapped function synchronously');
      setTimeout(() => {
        try {
          assert.equal(calls, 1, 'debounce must call the wrapped function exactly once after rapid repeated calls settle');
          resolve();
        } catch(e){ reject(e); }
      }, 60);
    } catch(e){ reject(e); }
  });
}

console.log('debounce() functional checks passed');
