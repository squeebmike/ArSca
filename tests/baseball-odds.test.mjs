import assert from 'node:assert/strict';
import {baseballOdds,baseballOddsHtml} from '../scripts/baseball-odds.mjs';
assert.deepEqual(baseballOdds['2023-topps-series-2'].rows.map(r=>r.odds),[[18,5],[10,2],[363,105],[469,136]]);
const html=baseballOddsHtml('2023-topps-series-2',v=>String(v));
assert.ok(html.includes('5191'));assert.ok(html.includes('5192'));assert.ok(html.includes('1 in 363 packs'));assert.ok(html.includes('not the odds of one named player'));
assert.equal(baseballOddsHtml('2023-topps-series-1',String),'');
assert.equal(baseballOddsHtml('2019-topps-chrome',String),'');
console.log('Publisher odds stay scoped to exact set, category and pack format');
