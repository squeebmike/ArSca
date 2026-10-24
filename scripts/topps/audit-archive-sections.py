"""Audit complete printed section blocks; unknown lines prevent publication of that block."""
import json,re,hashlib,unicodedata
from pathlib import Path
from collections import OrderedDict
base_identities=json.loads(Path('../outputs/sports-primary-base-identities.json').read_text(encoding='utf-8'))
sources=json.loads(Path('../outputs/sports-source-files.json').read_text(encoding='utf-8'))
teamsets={sport:sorted({t for s in sources if s['sport']==sport for t in s['teams']},key=len,reverse=True) for sport in ['baseball','football']}
# These historical clubs are printed in the already-reviewed source imports.
teamsets['baseball']+=['Cleveland Indians','Brooklyn Dodgers','Montreal Expos','Montréal Expos','Kansas City Athletics','Milwaukee Braves','St. Louis Browns','Washington Senators','Tampa Bay Devil Rays','New York Giants','Florida Marlins','Cleveland','Homestead Grays','San Francsico Giants','Montreàl Expos','YOMIURI GIANTS','USA','Japan','JAPAN','Dominican Republic','Venezuela','Puerto Rico','Canada','Mexico','Cuba','Chinese Taipei','South Korea','Major League Baseball','American League','National League','Musician','Music Producer']
teamsets['football']+=['St. Louis Rams','Houston Oilers','Los Angeles Raiders','Oakland Raiders','San Diego Chargers']
teamsets['baseball']+=['Israel','Isreal','Netherlands','Great Britain','Italy','Colombia','Korea','United States','Australia','Czech Republic','Czechia','Nicaragua','Panama','China','Brazil','Expos','Giants','Pittsburgh','Boston Americans','Boston Braves','SoftBank Hawks','Cincinatti Reds','Kanas City Royals','Equipment','Brooklyn','President of the United States','"Father of Baseball"','Commissioner of Baseball','Baseball Executive','Baseball Statistician','First Baseman']
def slug(s):return re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()).strip('-')
def kind(name,category):
 if re.search('AUTO|CHROMOGRAPH',name):return 'Autograph relics' if re.search('RELIC|PATCH|AUTHENTIC',name) else 'Autographs'
 if re.search('RELIC|PATCH|FABRIC',name):return 'Relics'
 if re.search('VARIATION|PARALLEL|FRACTOR',name):return 'Variations'
 if 'PROSPECT' in name:return 'Prospects'
 return category
out=[];audit=[]
for source in sources:
 assert hashlib.sha256(Path(source['file']).read_bytes()).hexdigest()==source['hash'],source['id']
 if source['id'] in ['2025-topps-chrome-black-football','2026-topps-heritage-football','2025-topps-series-1-baseball','2020-topps-baseball-series-1','2020-topps-baseball-series-2','2020-topps-updates-baseball','2021-topps-series-1-baseball','2021-topps-series-2-baseball','2021-topps-updates-baseball']:
  from pypdf import PdfReader
  from collections import defaultdict
  lines=[]
  for page in PdfReader(source['file']).pages:
   positioned=defaultdict(list)
   def visit(text,cm,tm,font,size):
    if text.strip():positioned[round(tm[5],1)].append((tm[4],text.strip()))
   page.extract_text(visitor_text=visit)
   lines.extend(' '.join(t for _,t in sorted(row)) for y,row in sorted(positioned.items(),reverse=True))
  if source['id']!='2025-topps-chrome-black-football':
   # Repair only whitespace against the same printed row. Keep the original
   # source order and section boundaries, even when PDF coordinates overlap.
   positioned_rows={re.sub(r'\s+','',line):line for line in lines}
   lines=[positioned_rows.get(re.sub(r'\s+','',line),line) for line in Path(source['file']).with_suffix('.txt').read_text(encoding='utf-8-sig').splitlines()]
 else:lines=Path(source['file']).with_suffix('.txt').read_text(encoding='utf-8-sig').splitlines()
 groups=[];current=None;category='Inserts'
 teams=sorted(set(teamsets[source['sport']]),key=len,reverse=True)
 # Prefer full club names before shorthand such as Giants or Cleveland;
 # otherwise the city could leak into the player's name (or vice versa).
 short_teams=['Giants','Expos','Pittsburgh','Cleveland','Brooklyn']
 pattern=re.compile(r'^(.+?)\s*('+'|'.join(re.escape(x) for x in teams if x not in short_teams)+r')(?=[®™\s(]|$|Rookie)[®™]?(?:\s*(.*))?$',re.I)
 short_pattern=re.compile(r'^(.*?)\s+('+'|'.join(short_teams)+r')[®™]?(?:\s*(.*))?$',re.I)
 for raw in lines:
  line=re.sub(r'\s+',' ',raw).strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati').replace('United StatesGreatest','United States Greatest')
  if not line:continue
  if line in ['SUBJECT TO CHANGE*','*SUBJECT TO CHANGE*','Season Highlights/Checklist','Combo Card/Checklist','Hobby/HTA Exclusive','Hobby Exclusive','Hobby/Hobby Jumbo Exclusive','vary.','Hobby Only Exclusive','Retail Holiday Tin Exclusive','Walmart Exclusive','Target Exclusive','Relic Box Exclusive','Retail Display Box/Gravity Feed Exclusive','Retail Relic Box Exclusive','HOBBY JUMBO EXCLUSIVE Boxtoppers','production, but actual contents and odds may vary.']:continue
  if re.fullmatch(r'(?:Retail Exclusive|Hobby(?:/Hobby Jumbo)? Only(?: - Silver Pack Boxloader)?|Hobby Jumbo Exclusive Boxtopper|Hobby/Hobby Jumbo Only - Silver Pack Boxloader|Hobby/Hobby Jumbo Only)',line):continue
  if line.startswith(('Checklists provided by Topps reflect','product at the time of production, but actual contents','of production, but actual contents')):continue
  if line in ['BASE','INSERT','AUTOGRAPH','AUTOGRAPH RELIC','RELIC']:
   category={'BASE':'Variations','INSERT':'Inserts','AUTOGRAPH':'Autographs','AUTOGRAPH RELIC':'Autograph relics','RELIC':'Relics'}[line];current=None;continue
  # Country names can occur in headings as well as team columns. Recognize
  # all-caps headings before considering a team suffix as a card row.
  first=line.split()[0]
  if re.fullmatch(r'''[A-Z0-9][A-Z0-9 &'’:"/().,!?+\-–—]+''',line) and (first.isalpha() or re.fullmatch(r'(?:19|20)\d{2}',first)):
   if line in ['TOKYO SERIES EXCLUSIVE','JAPAN EDITION']:
    category='Inserts';current=None;continue
   current={'name':line,'category':category,'rows':OrderedDict(),'errors':[]};groups.append(current);continue
  row=re.fullmatch(r'([\w]+(?:-[\w]+)*\.?)\s+(.+)',line)
  parsed=(pattern.fullmatch(row[2]) or short_pattern.fullmatch(row[2])) if row else None
  if row and not parsed and source['id']=='2025-bowman-draft-baseball' and re.search('[a-z]',row[2]) and re.fullmatch(r'[A-Z]+(?:-[A-Z0-9]+)+',row[1]):
   if current is not None:current['rows'].setdefault(row[1],[]).append({'name':row[2],'team':''})
   continue
  if row and not parsed and (row[2] in ['Buster Olney','Don Orsillo','Joe Buck','Ken Rosenthal','Michael Kay','Tim McCarver','Buck Leonard','Bill James','Bud Selig','Josh Gibson','Gary Cohen','Ryan Ruocco','Yoshinobu Yamamoto','Chris Taylor'] or (current and current['name'] in ['NOTABLE AMERICANS','GARY VEE TOP ENTREPRENEURS'] and re.fullmatch(r"[A-Z][A-Za-z .’'\-]+",row[2]))):
   if current is not None:current['rows'].setdefault(row[1],[]).append({'name':row[2],'team':''})
   continue
  if row and parsed:
   if current is None:continue
   no=row[1];player,team,note=parsed.groups()
   player=player.replace('®','').replace('™','').strip()
   if not player and note and 'Team Card' in note:player=team
   if not player:current['errors'].append(line);continue
   printed=team;team=next((t for t in teams if t.lower()==team.lower()),team)
   team={'San Francsico Giants':'San Francisco Giants','Montreàl Expos':'Montreal Expos','YOMIURI GIANTS':'Yomiuri Giants','JAPAN':'Japan','Isreal':'Israel','Cincinatti Reds':'Cincinnati Reds','Kanas City Royals':'Kansas City Royals'}.get(team,team)
   affiliation=team in ['Major League Baseball','American League','National League','Musician','Music Producer','Equipment','President of the United States','"Father of Baseball"','Commissioner of Baseball','Baseball Executive','Baseball Statistician','First Baseman']
   current['rows'].setdefault(no,[]).append({'name':player,'team':'' if affiliation else team,**({'sourceAffiliation':printed} if affiliation else {}),**({'note':note} if note else {})});continue
  if re.fullmatch(r"""[A-Z0-9][A-Z0-9 &'’:"/().,!?+\-–—]+""",line):
   current={'name':line,'category':category,'rows':OrderedDict(),'errors':[]};groups.append(current);continue
  if current:current['errors'].append(line)
 sections=[];skips=[]
 for g in groups:
  if not g['rows']:continue
  name=g['name'];numbers=list(g['rows'])
  baseline={x['number']:{slug(n) for n in x['names']} for x in base_identities[source['id']]}
  explicit_variant=bool(re.search(r'VARIATION|SHORT PRINT|FRACTOR|PARALLEL|\bSS?P\b',name))
  explicit_nonbase=explicit_variant or bool(re.search(r'AUTO|RELIC|PATCH|OVERSIZED|CHROMOGRAPH',name))
  if not explicit_nonbase and all(no in baseline and all(slug(v['name']) in baseline[no] for v in subjects) for no,subjects in g['rows'].items()):continue
  if g['errors']:skips.append({'name':name,'rows':len(numbers),'errors':g['errors']});continue
  variation=bool(re.search(r'VARIATION|SHORT PRINT|REFRACTOR|FRACTOR|PARALLEL',name))
  if any(re.fullmatch(r'\d+',n) for n in numbers) and not variation and g['category']=='Variations':continue
  if re.search(r'\bBASE\b|REDEMPTION',name) and not variation:continue
  if re.fullmatch(r'(?:CHROME |PAPER )?PROSPECTS(?: CARDS)?',name):continue
  if not variation and g['category']=='Variations' and not all(any(c.isalpha() for c in n) for n in numbers):continue
  cards=[];section_id=slug(name)
  for number,subjects in g['rows'].items():
   cards.append({'id':source['id']+'-'+section_id+'-'+slug(number),'cardNumber':number,'player':' / '.join(dict.fromkeys(x['name'] for x in subjects)),'team':' / '.join(dict.fromkeys(x['team'] for x in subjects)),'section':name.title(),'variant':'Base','subjects':subjects})
  if not cards:continue
  group={'id':section_id,'name':name.title(),'kind':kind(name,g['category']),'cards':cards}
  if variation:
   if 'SUPER SHORT PRINT' in name:group['matchTerms']=[[r'\bssp\b','super short print']]
   elif 'SHORT PRINT' in name:group.update(matchTerms=[[r'\bsp\b','short print']],excludeTerms=[r'\bssp\b','super short print'])
   else:
    words=[w for w in re.sub(r'\b(?:BASE|CARDS?|SET|VETERANS|ROOKIES|I|II|III|VARIATIONS?|PARALLELS?)\b',' ',name).lower().split() if len(w)>1]
    group['matchTerms']=[[r'\b'+re.escape(w)+r'\b'] for w in words] or [[r'\bvariations?\b']]
  if not variation and any(re.fullmatch(r'\d+',n) for n in numbers):
   words=[w for w in re.sub(r'\b(?:THE|BASE|CARDS?|SET|TOPPS|BASEBALL|FOOTBALL|AUTOGRAPHS?)\b',' ',name).lower().split() if len(w)>1]
   group['matchTerms']=[[r'\b'+re.escape(w)+r'\b'] for w in words] or [[re.escape(name.lower())]]
  sections.append(group)
 out.append({'setId':source['id'],'sport':source['sport'],'sourceUrl':source['sourceUrl'],'sourceSha256':source['hash'],'sections':sections})
 audit.append({'id':source['id'],'sections':[(x['name'],len(x['cards'])) for x in sections],'rejected':skips})
Path('../outputs/sports-section-candidates.json').write_bytes(json.dumps(out,ensure_ascii=False).encode())
Path('../outputs/sports-section-import-audit.json').write_bytes(json.dumps(audit,ensure_ascii=False,indent=2).encode())
print(json.dumps({'sets':len(out),'withSections':sum(bool(x['sections']) for x in out),'sections':sum(len(x['sections']) for x in out),'cards':sum(len(g['cards']) for x in out for g in x['sections']),'rejectedBlocks':sum(len(x['rejected']) for x in audit)}))
