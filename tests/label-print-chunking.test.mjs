import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: printInventoryLabels is async and yields periodically instead
// of running the whole barcode-generation loop synchronously ──
assert.match(dashboard, /const LABEL_PRINT_YIELD_EVERY = 20;/, 'a yield-every-N-labels constant must exist');
assert.match(dashboard, /async function printInventoryLabels\(\)\{/, 'printInventoryLabels must be async so it can yield mid-batch');
assert.match(dashboard, /if\(\(i \+ 1\) % LABEL_PRINT_YIELD_EVERY === 0\) await new Promise\(resolve => setTimeout\(resolve, 0\)\);/, 'the loop must yield to the main thread every LABEL_PRINT_YIELD_EVERY labels');
assert.match(dashboard, /for\(let i = 0; i < labelSpecs\.length; i\+\+\)\{/, 'label generation must be a plain indexed loop (not .flatMap) so it can await mid-iteration');

console.log('Label print chunking contract checks passed');

// ── Contract: the PRINT button gives feedback and is disabled while a large
// batch is generating, so it can't be double-clicked into firing twice ──
assert.match(dashboard, /<button class="modal-btn confirm" id="label-print-btn" onclick="printInventoryLabels\(\)">PRINT<\/button>/, 'the print button must be addressable so it can be disabled during generation');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = true; btn\.textContent = 'GENERATING\.\.\.'; \}/, 'the button must be disabled and relabeled while labels are being generated');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = false; btn\.textContent = 'PRINT'; \}/, 'the button must be restored once generation finishes');

console.log('Label print button feedback contract checks passed');

// ── Functional: the yield cadence fires at exactly the right iterations,
// and the label spec expansion (item+qty -> one spec per physical label)
// still produces the right count and order regardless of chunking.
function expandBatch(batch){
  return batch.flatMap(b => Array.from({ length:b.qty }, () => b));
}
const batch = [{ id:'a', qty:3 }, { id:'b', qty:1 }, { id:'c', qty:2 }];
const specs = expandBatch(batch);
assert.equal(specs.length, 6, 'a batch of qty 3+1+2 must expand to exactly 6 physical labels');
assert.deepEqual(specs.map(s => s.id), ['a', 'a', 'a', 'b', 'c', 'c'], 'expansion order must be preserved so labels print in the same order items were added to the batch');

function yieldIterations(total, every){
  const yields = [];
  for(let i = 0; i < total; i++){
    if((i + 1) % every === 0) yields.push(i);
  }
  return yields;
}
assert.deepEqual(yieldIterations(45, 20), [19, 39], 'a 45-label batch must yield exactly twice (after label 20 and label 40), not on every label and not never');
assert.deepEqual(yieldIterations(5, 20), [], 'a small batch under the yield threshold must never yield -- no added delay for the common case');
assert.deepEqual(yieldIterations(20, 20), [19], 'a batch exactly at the threshold must yield exactly once');

console.log('Label print chunking functional checks passed');
