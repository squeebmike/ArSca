"""Import the complete numbered non-base sections from Topps' 14-page checklist.
Run in ArSca after exporting printed team names to ../outputs/holiday-baseball-teams.json.
"""
from pathlib import Path
from pypdf import PdfReader
from collections import OrderedDict
import hashlib,json,re

source=Path('../outputs/library-completion/sports-sources/2026-topps-holiday-baseball.pdf')
teams=json.loads(Path('../outputs/holiday-baseball-teams.json').read_text(encoding='utf-8'))
groups=OrderedDict();current=None
for page in PdfReader(source).pages:
 for raw in page.extract_text().splitlines():
  line=re.sub(r'\s+',' ',raw.replace('®','').replace('™','')).strip()
  if not line or line=='2026 Topps Holiday Baseball' or line.startswith(('Checklists provided by Topps','the time of production,')):continue
  if line in ['INSERT','RELIC']:continue
  if line.isupper() and not re.match(r'^[A-Z]+\d+ ',line):
   current=line;groups.setdefault(current,[]);continue
  match=re.match(r'^([A-Z]+(?:-[A-Z0-9]+|\d+))\s+(.+)$',line)
  assert match and current,(current,line)
  number,rest=match.groups();note=''
  if rest.endswith(' Rookie'):rest=rest[:-7].strip();note='Rookie'
  team=next((t for t in sorted(teams,key=len,reverse=True) if rest.endswith(' '+t)),None)
  if team:name=rest[:-len(team)].strip()
  else:
   assert current=='HOLIDAY FAUX RELICS',(current,line)
   name=rest;team=''
  groups[current].append({'cardNumber':number,'player':name,'team':team,'subjects':[{'name':name,'team':team,'note':note}]})

slug=lambda s:re.sub('[^a-z0-9]+','-',s.lower()).strip('-')
set_id='2026-topps-holiday-baseball';sections=[]
assert len(groups.pop('BASE CARDS'))==200
for title,cards in groups.items():
 group_id=slug(title);name=title.title()
 kind='Relics' if 'RELIC' in title else 'Variations' if 'VARIATION' in title else 'Inserts'
 for card in cards:card.update(id=set_id+'-'+group_id+'-'+slug(card['cardNumber']),section=name,variant='Base')
 assert len(cards)==len({c['id'] for c in cards}),title
 group={'id':group_id,'name':name,'kind':kind,'cards':cards}
 if title=='BASE CARDS CHROME VARIATION':group['matchTerms']=[[r'\bchrome\b']]
 elif 'VARIATION' in title:
  group['matchTerms']=[[r'\bvariation\b',r'\bsp\b',r'\bssp\b']]
  if 'BACKS' in title:group['matchTerms'].append([r'\bbacks?\b'])
  else:group['excludeTerms']=[r'\bbacks?\b']
  if 'SUPER SHORT' in title:group['matchTerms'].append([r'\bssp\b',r'\bsuper short\b'])
  else:group.setdefault('excludeTerms',[]).extend([r'\bssp\b',r'\bsuper short\b'])
 sections.append(group)
assert len(sections)==11
assert sum(len(s['cards']) for s in sections)==440
payload=[{'setId':set_id,'sourceUrl':'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Holiday_Baseball_26THBW_-_Checklist.pdf?v=1789566977','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sections':sections}]
Path('scripts/topps/holiday-baseball-sections.mjs').write_text('// Verified printed card identities; no inferred parallel eligibility.\nexport const holidayBaseballSections='+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print(json.dumps({'sections':len(sections),'cards':sum(len(s['cards']) for s in sections)}))

# Keep format columns and unusual ratios such as 4:1 exactly as printed.
odds_source=Path('../outputs/holiday-baseball-odds.pdf')
odds_rows=[]
for page in PdfReader(odds_source).pages:
 for raw in page.extract_text(extraction_mode='layout').splitlines():
  cells=re.split(r'\s{2,}',raw.strip())
  if len(cells)==4 and re.fullmatch(r'[\d,.]+:[\d,.]+|—',cells[1]):
   odds_rows.append({'name':cells[0].title(),'odds':[None if cell=='—' else cell for cell in cells[1:]]})
assert len(odds_rows)==66
Path('scripts/topps/holiday-baseball-odds-data.mjs').write_text('// Publisher format columns: Mega Box, Collector Tin, Advent Calendar.\nexport const holidayOddsRows='+json.dumps(odds_rows,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
