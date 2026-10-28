import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sportsChecklistNavigation} from '../scripts/sports-checklist-ui.mjs';
const html=sportsChecklistNavigation({id:'test',sourceUrl:'https://example.com'},[],String);
let change,submissions=0;const attrs={};const picker={value:'base',form:{requestSubmit(){submissions++},setAttribute(k,v){attrs[k]=v}},addEventListener(name,fn){assert.equal(name,'change');change=fn}};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document:{getElementById:()=>picker}});
assert.equal(submissions,0);picker.value='odds';change();assert.equal(submissions,1);assert.equal(attrs['data-auto-navigate'],'');
assert.ok(html.includes('<button type="submit">Go</button>'),'non-JavaScript fallback remains available');
console.log('Section selection submits immediately with progressive enhancement');
