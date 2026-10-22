import json,re,unicodedata
from pathlib import Path
c=json.loads(Path('../outputs/sports-section-candidates.json').read_text(encoding='utf-8'));e=json.loads(Path('../outputs/existing-sports-sections.json').read_text(encoding='utf-8'))
norm=lambda s:re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
existing={x['setId']:x['sections'] for x in e};out=[];skips=[]
for x in c:
 groups=[]
 for g in x['sections']:
  old=existing.get(x['setId'],[])
  same=next((z for z in old if norm(z['name'])==norm(g['name']) or z['id']==g['id']),None)
  if same:continue
  if any(any(t in str(v) for t in ['\ufffd','Ã','Â']) for card in g['cards'] for v in [card['player'],card['team']]):raise ValueError((x['setId'],g['name'],'encoding'))
  signature=lambda z:{(a['cardNumber'],norm(a['player'])) for a in z['cards']}
  dup=next((z for z in old if signature(z)==signature(g) and (norm(z['name']) in norm(g['name']) or norm(g['name']) in norm(z['name']))),None)
  if dup:skips.append([x['setId'],g['name'],dup['name']]);continue
  groups.append(g)
 if groups:out.append({k:v for k,v in dict(x,sections=groups).items() if k!='sport'})
Path('scripts/topps/archive-nonbase-sections.mjs').write_bytes(('// Complete parsed publisher blocks only. Existing reviewed routes are retained.\nexport const archiveNonbaseSections='+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n').encode())
Path('../outputs/archive-sections-added.json').write_bytes(json.dumps({'sets':len(out),'sections':sum(len(x['sections']) for x in out),'cards':sum(len(g['cards']) for x in out for g in x['sections']),'deduped':skips},ensure_ascii=False,indent=2).encode())
print(Path('../outputs/archive-sections-added.json').read_text(encoding='utf-8')[:1400])
