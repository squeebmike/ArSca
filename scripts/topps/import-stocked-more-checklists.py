from pathlib import Path
import json,re,hashlib
# Reuse the already-reviewed printed-team parser, including historical names.
exec(Path('scripts/topps/import-stocked-checklists.py').read_text(encoding='utf-8').split('counts=')[0])
root=Path('../outputs/checklist-expansion-2026-10-20-b')
sources=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
specs={'2024-bowman-baseball':100,'2024-bowman-chrome-baseball':100,'2023-bowman-s-best-baseball':70,'2023-topps-chrome-update-series-baseball':220}
sectionspecs={'2024-bowman-baseball':[('chrome-prospects','Chrome Prospects',['CHROME PROSPECTS I','CHROME PROSPECTS II'],'BCP-',1,150),('paper-prospects','Paper Prospects',['PAPER PROSPECTS I','PAPER PROSPECTS II'],'BP-',1,150)],'2024-bowman-chrome-baseball':[('chrome-prospects','Chrome Prospects',['BOWMAN CHROME PROSPECTS'],'BCP-',153,252)],'2023-bowman-s-best-baseball':[('top-prospects','Top Prospects',['TOP PROSPECTS'],'TP-',1,30)]}
sets=[];groups=[];errors=[]
def parse(line,id,section):
 m=re.match(r'^([A-Z]*-?\d+|[A-Z]+-[A-Z0-9-]+)\s+(.+)$',line)
 if not m:raise ValueError(line)
 number,rest=m.groups();t=team_re.match(rest)
 if not t:raise ValueError((id,line))
 player,team,note=t.groups();team=next(x for x in teams if x.lower()==team.lower())
 return {'id':id+'-'+number.lower(),'cardNumber':number,'player':player,'team':team,'section':section,'variant':'Base','subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]}
for src in sources:
 id=src['id']
 if id not in specs:continue
 lines=[l.strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati') for l in (root/(id+'.txt')).read_text(encoding='utf-8').splitlines()]
 prefix='USC' if 'update' in id else '';start=next(i for i,l in enumerate(lines) if re.match('^'+prefix+'1\\s+',l));rows=[]
 for line in lines[start:]:
  if not line:continue
  if not re.match('^'+prefix+r'\d+\s',line):break
  rows.append(parse(line,id,'Base'))
 assert {c['cardNumber'] for c in rows}=={prefix+str(i) for i in range(1,specs[id]+1)} and len(rows)==specs[id],id
 name=src['name'].replace('®','');sets.append({'id':id,'year':int(id[:4]),'sport':'baseball','brand':'Bowman' if 'bowman' in id else 'Topps','setName':name,'displayName':name,'scope':'Official base section only. Prospect sections are linked separately; inserts, autograph subsets and variations are not included in the base list.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':[],'sourceUrl':src['url'],'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'cards':rows})
 sections=[]
 for sectionid,name,heads,prefix,lo,hi in sectionspecs.get(id,[]):
  rows=[]
  for head in heads:
   start=lines.index(head)
   for line in lines[start+1:]:
    if not line:continue
    if not re.match('^'+prefix+r'\d+\s',line):break
    rows.append(parse(line,id,name))
  assert {c['cardNumber'] for c in rows}=={prefix+str(i) for i in range(lo,hi+1)} and len(rows)==hi-lo+1,(id,name)
  sections.append({'id':sectionid,'name':name,'kind':'Prospects','cards':rows})
 if sections:groups.append({'setId':id,'sections':sections})
# Sterling's base section has two distinct printed number prefixes, not 1-100.
src=next(x for x in sources if x['id']=='2023-bowman-sterling-baseball');id=src['id'];lines=[l.strip() for l in (root/(id+'.txt')).read_text(encoding='utf-8').splitlines()];rows=[]
for heading,prefix,lo,hi in [('PROSPECT','BSP-',51,100),('ROOKIE','BSR-',1,50)]:
 start=lines.index(heading);part=[]
 for line in lines[start+1:]:
  if not line:continue
  if not re.match('^'+prefix+r'\d+\s',line):break
  card=parse(line,id,'Base');card['subjects'][0]['note']=heading.title();part.append(card)
 assert len(part)==hi-lo+1 and {c['cardNumber'] for c in part}=={prefix+str(i) for i in range(lo,hi+1)}
 rows.extend(part)
sets.append({'id':id,'year':2023,'sport':'baseball','brand':'Bowman','setName':src['name'],'displayName':src['name'],'scope':'Official base section: 50 BSP-numbered prospects and 50 BSR-numbered rookies. Autographs are separate sections.','licensedBaseball':True,'reviewed':True,'cardCount':100,'unissuedNumbers':[],'sourceUrl':src['url'],'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'cards':rows})
sections=[]
for heading,prefix in [('PROSPECT AUTOGRAPHS','PA-'),('ROOKIE AUTOGRAPHS','RA-')]:
 start=lines.index(heading);rows=[]
 for line in lines[start+1:]:
  if not line:continue
  if not re.match('^'+prefix+r'[A-Z0-9-]+\s',line):break
  rows.append(parse(line,id,heading.title()))
 assert rows and len({c['cardNumber'] for c in rows})==len(rows)
 sections.append({'id':heading.lower().replace(' ','-'),'name':heading.title(),'kind':'Autographs','cards':rows})
groups.append({'setId':id,'sections':sections})
# Existing reviewed 2026 releases: add their separately numbered prospect sections.
prospect_root=Path('../outputs/library-completion/sports-sources')
for id,specs2026 in [('2026-bowman-baseball',[('paper-prospects','Paper Prospects','PAPER PROSPECTS','BP-',1,150),('chrome-prospects','Chrome Prospects','CHROME PROSPECTS','BCP-',1,150)]),('2026-bowman-chrome-baseball',[('chrome-prospects','Chrome Prospects','BOWMAN CHROME PROSPECTS','BCP-',151,250)])]:
 lines=[l.strip() for l in (prospect_root/(id+'.txt')).read_text(encoding='utf-8').splitlines()];sections=[]
 for sectionid,name,heading,prefix,lo,hi in specs2026:
  start=lines.index(heading);rows=[]
  for line in lines[start+1:]:
   if not line:continue
   if not re.match('^'+prefix+r'\d+\s',line):break
   rows.append(parse(line,id,name))
  assert len(rows)==hi-lo+1 and {c['cardNumber'] for c in rows}=={prefix+str(i) for i in range(lo,hi+1)},(id,name)
  sections.append({'id':sectionid,'name':name,'kind':'Prospects','cards':rows})
 groups.append({'setId':id,'sections':sections})
Path('scripts/topps/baseball-stocked-more-2026-10.mjs').write_bytes(('// Verified official Topps/Bowman base and separate prospect sections.\nexport const baseballStockedMoreSets = '+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+';\nexport const baseballStockedMoreSections = '+json.dumps(groups,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps({'sets':[(s['id'],len(s['cards'])) for s in sets],'sections':[(s['setId'],[(g['name'],len(g['cards'])) for g in s['sections']]) for s in groups]}))