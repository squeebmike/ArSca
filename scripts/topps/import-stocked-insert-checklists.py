from pathlib import Path
import json,re,hashlib
exec(Path('scripts/topps/import-stocked-checklists.py').read_text(encoding='utf-8').split('counts=')[0])
specs=[
 ('checklist-expansion-2026-10-20','2025-topps-chrome-baseball','CHROME ALL ETCH','Chrome All Etch','CAE-',20),
 ('checklist-expansion-2026-10-20','2023-topps-pristine-baseball','OH SNAP','Oh Snap','OS-',15),
 ('checklist-expansion-2026-10-20-b','2023-bowman-s-best-baseball','BEST OF 2023 EARLY FORM AUTOGRAPHS','Best of 2023 Early Form Autographs','B23-',103),
 ('checklist-expansion-2026-10-20-b','2023-bowman-sterling-baseball','STERLING TEK','Sterling Tek','ST-',25),
 ('checklist-expansion-2026-10-20-c','2022-topps-update-baseball','STARS OF MLB','Stars of MLB','SMLB-',30),
 ('library-completion/sports-sources','2026-bowman-baseball','POWER CHORDS','Power Chords','PC-',25),
]
groups=[]
for folder,id,heading,name,prefix,count in specs:
 root=Path('../outputs')/folder
 lines=(root/(id+'.txt')).read_text(encoding='utf-8').splitlines()
 start=next(i for i,l in enumerate(lines) if l.strip()==heading)
 rows=[]
 for line in lines[start+1:]:
  line=line.strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati')
  if not line:continue
  m=re.match('^('+re.escape(prefix)+r'[A-Z0-9-]+)\s+(.+)$',line)
  if not m:break
  number,rest=m.groups();t=team_re.match(rest)
  if not t:raise ValueError((id,line))
  player,team,note=t.groups();team=next(x for x in teams if x.lower()==team.lower())
  rows.append({'id':id+'-'+number.lower(),'cardNumber':number,'player':player,'team':team,'section':name,'variant':'Base','subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]})
 assert rows and len({c['cardNumber'] for c in rows})==len(rows),id
 if count:assert len(rows)==count,(id,len(rows),count)
 groups.append({'setId':id,'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'sections':[{'id':re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-'),'name':name,'kind':'Autographs' if 'Autographs' in name else 'Inserts','cards':rows}]})
Path('scripts/topps/baseball-stocked-inserts-2026-10.mjs').write_bytes(('// Publisher-reviewed insert and autograph sections; never merged into base cards.\nexport const baseballStockedInsertSections='+json.dumps(groups,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps([{'set':g['setId'],'section':g['sections'][0]['name'],'cards':len(g['sections'][0]['cards'])} for g in groups]))
