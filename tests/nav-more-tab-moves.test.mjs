import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "Card intake and tasks and sets need to be pushed to the more tab."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const list = name => {
  const m = dashboard.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];'));
  assert.ok(m, name + ' exists');
  return [...m[1].matchAll(/\['([a-z]+)', '[^']+'\]/g)].map(x => x[1]);
};
const daily = list('DAILY_TABS'), more = list('MORE_TABS');
for (const id of ['cardintake', 'tasks', 'sets']) {
  assert.ok(!daily.includes(id), id + ' is off the main bar');
  assert.ok(more.includes(id), id + ' is in MORE');
}
assert.deepEqual(daily, ['overview', 'research', 'intake', 'display', 'scout', 'inventory', 'shows', 'whatnot', 'channels'], 'the rest of the main bar is unchanged');
assert.deepEqual(more.slice(0, 4), ['browse', 'cardintake', 'tasks', 'sets'], 'they sit at the top of MORE');
console.log('Nav: card intake, tasks and sets under MORE checks passed');
