"""Import only printed sections from the downloaded official Chrome Football PDF text.
Run from repository root; source documents remain under ../outputs/library-completion.
"""
import hashlib, json, re
from pathlib import Path
from collections import OrderedDict

source=Path('../outputs/library-completion/sports-sources/2025-topps-chrome-football')
teams=json.loads(Path('../outputs/sports-checklist-ux-2026-10-21/teams.json').read_text(encoding='utf-8'))
teams+=['St. Louis Rams','Houston Oilers','Los Angeles Raiders','Oakland Raiders','San Diego Chargers']
groups=[]; current=None; category='Variations'
categories={'BASE':'Variations','INSERT':'Inserts','AUTOGRAPH':'Autographs','AUTOGRAPH RELIC':'Autograph relics','RELIC':'Relics'}
for raw in source.with_suffix('.txt').read_text(encoding='utf-8').splitlines():
    line=re.sub(r'\s+',' ',raw).strip()
    if not line: continue
    if line in ['Checklists provided by Topps reflect the intended configuration of that','product at the time of production, but actual contents and odds may vary.']: continue
    if line in categories:
        category=categories[line]; continue
    if current and current['name']=='FANATICS AUTHENTICS REDEMPTION CARDS' and any(c.islower() for c in line): continue
    match=re.match(r'^([A-Z0-9]+(?:-[A-Z0-9]+)*)\s+(.+)$',line)
    if match and any(c.islower() for c in match[2]):
        assert current is not None, line
        rest=match[2]; note=''
        if rest.endswith(' Rookie'): rest=rest[:-7].strip(); note='Rookie'
        team=next((t for t in sorted(teams,key=len,reverse=True) if rest.endswith(' '+t)),None)
        assert team, line
        subject={'name':rest[:-len(team)].strip(),'team':team,'note':note}
        current['rows'].setdefault(match[1],[]).append(subject)
    elif re.fullmatch(r"[A-Z0-9][A-Z0-9 &'’:/().,-]+",line):
        current={'name':line,'kind':category,'rows':OrderedDict()}; groups.append(current)
    else:
        raise ValueError('Unrecognized source line: '+line)

def slug(value): return re.sub('[^a-z0-9]+','-',value.lower()).strip('-')
set_id='2025-topps-chrome-football'
sections=[]
for group in groups:
    if group['name'] in ['BASE CARDS','ROOKIES','FANATICS AUTHENTICS REDEMPTION CARDS']: continue
    name=group['name'].title().replace('Topps','Topps').replace('Nfl','NFL').replace('Prem1Ere','PREM1ERE')
    kind='Variations' if 'VARIATION' in group['name'] and group['kind']=='Inserts' else group['kind']
    group_id=slug(group['name']); cards=[]
    for number,subjects in group['rows'].items():
        assert len({(s['name'],s['team']) for s in subjects})==len(subjects)
        cards.append({'id':set_id+'-'+group_id+'-'+slug(number),'cardNumber':number,'player':' / '.join(s['name'] for s in subjects),
                      'team':' / '.join(dict.fromkeys(s['team'] for s in subjects)),'section':name,'variant':'Base','subjects':subjects})
    assert cards
    sections.append({'id':group_id,'name':name,'kind':kind,'cards':cards})

assert len(sections)==40, len(sections)
payload=[{'setId':set_id,'sourceUrl':'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Chrome_Football_Checklist_040826.pdf?v=1775678965',
          'sourceSha256':hashlib.sha256(source.with_suffix('.pdf').read_bytes()).hexdigest(),'sections':sections}]
Path('scripts/topps/football-sections.mjs').write_bytes(('// Printed publisher sections; duplicate numbers retain every listed subject.\nexport const footballSections='+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n').encode('utf-8'))
print(json.dumps({'sections':len(sections),'cards':sum(len(g['cards']) for g in sections),'dualAutographs':len(next(g for g in sections if g['id']=='dual-autographs')['cards'])}))
