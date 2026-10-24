"""Validate official 2020/2021 flagship base lists before publishing records."""
from pathlib import Path
from collections import OrderedDict
import json,re,hashlib
exec(Path('scripts/topps/import-stocked-checklists.py').read_text(encoding='utf-8').split('counts=')[0])
teams+=['American League','National League']
team_re=re.compile(r'^(.+?)\s*('+'|'.join(re.escape(t) for t in sorted(set(teams),key=len,reverse=True))+r')[®™]?(?:\s+(.*))?$',re.I)
root=Path('../outputs/next-topps-sources')
specs={
 '2020-topps-baseball-series-1':('',1,350),
 '2020-topps-baseball-series-2':('',351,700),
 '2020-topps-updates-baseball':('U-',1,300),
 '2021-topps-series-1-baseball':('',1,330),
 '2021-topps-series-2-baseball':('',331,660),
 '2021-topps-updates-baseball':('US',1,330),
}
sets=[];audit=[]
for source in json.loads((root/'manifest.json').read_text(encoding='utf-8')):
 id=Path(source['file']).stem
 if id not in specs:continue
 assert hashlib.sha256(Path(source['file']).read_bytes()).hexdigest()==source['sha256']
 prefix,start,end=specs[id];expected={prefix+str(n) for n in range(start,end+1)}
 rows=OrderedDict();issues=[];last=None
 for raw in (root/(id+'.txt')).read_text(encoding='utf-8').splitlines():
  line=raw.strip()
  if not line:continue
  m=re.fullmatch('('+re.escape(prefix)+r'\d+)\s*(.+)',line)
  if not m:
   if rows:break
   continue
  number,rest=m.groups()
  if number not in expected:break
  # The PDF omits whitespace between the team trademark and printed notes.
  rest=re.sub(r'([®™])(?=\S)',r'\1 ',rest)
  subject=team_re.fullmatch(rest)
  if not subject:issues.append(line);continue
  player,team,note=subject.groups()
  affiliation=team in ['American League','National League']
  subject={'name':player,'team':'' if affiliation else team,**({'sourceAffiliation':team} if affiliation else {}),**({'note':note} if note else {})}
  row=rows.setdefault(number,{'id':id+'-'+number.lower(),'cardNumber':number,'section':'Base','variant':'Base','subjects':[]})
  row['subjects'].append(subject);last=number
 missing=sorted(expected-set(rows))
 audit.append({'set':id,'rows':len(rows),'missing':missing,'issues':issues})
 if missing or issues:continue
 for row in rows.values():
  row['player']=' / '.join(dict.fromkeys(s['name'] for s in row['subjects']))
  row['team']=' / '.join(dict.fromkeys(s['team'] for s in row['subjects']))
 sets.append({'id':id,'year':int(id[:4]),'sport':'baseball','brand':'Topps','setName':source['name'],'displayName':source['name'],'scope':'Verified publisher base checklist. Inserts and variations are listed separately where reviewed.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':[],'sourceUrl':source['sourceUrl'],'sourceSha256':source['sha256'],'cards':list(rows.values())})
Path('../outputs/flagship-2020-2021-audit.json').write_bytes(json.dumps(audit,ensure_ascii=False,indent=2).encode())
Path('scripts/topps/baseball-flagship-2020-2021.mjs').write_bytes(('// Generated from official Topps PDFs by import-flagship-2020-2021.py.\nexport const baseballFlagship2020And2021Sets='+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps([{'set':a['set'],'rows':a['rows'],'missing':len(a['missing']),'issues':a['issues'][:4]} for a in audit]))
