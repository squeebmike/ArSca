from pathlib import Path
import ast,re,json,hashlib
root=Path('../outputs/checklist-expansion-2026-10-20');tree=ast.parse(Path('scripts/topps/import-2023-baseball.py').read_text(encoding='utf-8'))
teams=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='teams' for t in n.targets))+['Cleveland Indians','Brooklyn Dodgers','Montreal Expos','Kansas City Athletics','Milwaukee Braves','St. Louis Browns','Washington Senators','Tampa Bay Devil Rays','Athletics','New York Giants','Montréal Expos','Cleveland','Florida Marlins']
team_re=re.compile(r'^(.*?)\s+('+'|'.join(re.escape(t) for t in sorted(set(teams),key=len,reverse=True))+r')[®™]?(?:\s+(.*))?$',re.I)
counts={'2025-topps-chrome-baseball':300,'2022-topps-chrome-platinum-anniversary':500,'2022-topps-chrome-updates-baseball':200,'2023-topps-cosmic-chrome-baseball':200,'2024-topps-chrome-baseball':300,'2024-topps-chrome-update-series-baseball':200,'2022-topps-chrome-baseball-sonic-edition':220,'2023-topps-finest-baseball':100,'2023-topps-pristine-baseball':300}
sets=[];errors=[];review=[];section_sets=[]
for source in json.loads((root/'manifest.json').read_text(encoding='utf-8')):
 id=source['id'];prefix='USC' if 'update' in id else '';rows=[];started=False;lines=(root/(id+'.txt')).read_text(encoding='utf-8').splitlines()
 for line in lines:
  line=line.strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati')
  if not started:
   if not re.match('^'+prefix+r'1\s+',line):continue
   started=True
  if not line:continue
  m=re.match(r'^('+prefix+r'\d+)\s+(.+)$',line)
  if not m:
   review.append({'id':id,'boundary':line,'last':rows[-1] if rows else None});break
  number,rest=m.groups();t=team_re.match(rest)
  if not t:errors.append({'id':id,'line':line});continue
  player,team,note=t.groups();team=next(x for x in teams if x.lower()==team.lower())
  rows.append({'id':id+'-'+number.lower(),'cardNumber':number,'section':'Base','variant':'Base','player':player,'team':team,'subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]})

 # Separate official autograph sections. Never append these rows to the base list.
 section_specs={'2025-topps-chrome-baseball':('ROOKIE AUTOGRAPHS','RA-'),'2024-topps-chrome-baseball':('ROOKIE AUTOGRAPHS','RA-'),'2022-topps-chrome-platinum-anniversary':('AUTOGRAPH CARDS','CPA-'),'2023-topps-finest-baseball':('FINEST AUTOGRAPHS','FA-')}
 if id in section_specs:
  heading,section_prefix=section_specs[id];start=next(i for i,l in enumerate(lines) if l.strip()==heading);section_rows=[]
  for line in lines[start+1:]:
   line=line.strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati')
   if not line:continue
   m=re.match(r'^('+re.escape(section_prefix)+r'[A-Z0-9-]+)\s+(.+)$',line)
   if not m:break
   number,rest=m.groups();t=team_re.match(rest)
   if not t:errors.append({'id':id,'section':heading,'line':line});continue
   player,team,note=t.groups();team=next(x for x in teams if x.lower()==team.lower())
   section_rows.append({'id':id+'-'+number.lower(),'cardNumber':number,'section':heading.title(),'variant':'Base','player':player,'team':team,'subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]})
  if not section_rows or len({r['cardNumber'] for r in section_rows})!=len(section_rows):errors.append({'id':id,'section':heading,'error':'empty/duplicate numbered autograph list'})
  section_sets.append({'setId':id,'sections':[{'id':heading.lower().replace(' ','-'),'name':heading.title(),'kind':'Autographs','cards':section_rows}]})
 expected={prefix+str(i) for i in range(1,counts[id]+1)}
 if {r['cardNumber'] for r in rows}!=expected or len(rows)!=len(expected):errors.append({'id':id,'rows':len(rows),'missing':sorted(expected-{r['cardNumber'] for r in rows})})
 name=source['name'].replace('®','').replace('Updates Baseball','Update Series Baseball').replace('Chrome Platinum Anniversary','Chrome Platinum Anniversary Baseball').replace('Chrome Baseball Sonic Edition','Chrome Sonic Baseball')
 sets.append({'id':id,'year':int(id[:4]),'sport':'baseball','brand':'Topps','setName':name,'displayName':name,'scope':'Publisher base section only. Inserts, autograph subsets, image variations and extended short prints are separate; see the official master PDF.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':[],'sourceUrl':source['url'],'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'cards':rows})
(root/'parse-review.json').write_text(json.dumps({'errors':errors,'boundaries':review},ensure_ascii=False,indent=2),encoding='utf-8')
if errors:print(json.dumps(errors,ensure_ascii=False));raise SystemExit(1)
Path('scripts/topps/baseball-stocked-2026-10.mjs').write_bytes(('// Verified base sections from official Topps PDFs; source hashes retained per set.\nexport const baseballStockedSets = '+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+';\nexport const baseballStockedSections = '+json.dumps(section_sets,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps([{'set':s['setId'],'sections':[(g['name'],len(g['cards'])) for g in s['sections']]} for s in section_sets]));print(json.dumps([{'id':s['id'],'name':s['displayName'],'cards':s['cardCount']} for s in sets]))