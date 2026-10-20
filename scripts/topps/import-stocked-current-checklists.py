from pathlib import Path
import json,re,hashlib,unicodedata
exec(Path('scripts/topps/import-stocked-checklists.py').read_text(encoding='utf-8').split('counts=')[0])
root=Path('../outputs/checklist-expansion-2026-10-20-c');sources=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
specs={'2025-topps-holiday-baseball':('H',1,200,'INSERT'),'2026-topps-heritage-baseball':('',1,400,'INSERT'),'2024-topps-archives-baseball':('',1,300,'INSERT'),'2025-topps-heritage-baseball':('',1,500,'END VERIFIED BASE'),'2022-topps-gallery-baseball':('',1,200,'INSERT'),'2024-topps-baseball-series-1':('',1,350,'GOLDEN MIRROR IMAGE VARIATION'),'2024-topps-baseball-series-2':('',351,700,'GOLDEN MIRROR IMAGE VARIATION'),'2022-topps-update-baseball':('US',1,330,'Hobby Only')}
sets=[];errors=[]
for src in sources:
 id=src['id']
 if id not in specs or src.get('error'):continue
 prefix,lo,hi,end=specs[id];rows={};context='Base';started=False
 lines=(root/(id+'.txt')).read_text(encoding='utf-8').splitlines()
 if id=='2025-topps-heritage-baseball':
  first=next(i for i,l in enumerate(lines) if l.strip()=='VETERANS CHROME VARIATION');start=next(i for i,l in enumerate(lines) if l.strip()=='HIGH NUMBERED SHORT PRINTS');stop=next(i for i,l in enumerate(lines) if l.strip()=='HIGH NUMBERED SHORT PRINTS CHROME VARIATION');lines=lines[:first]+lines[start:stop]+['END VERIFIED BASE']
 for raw in lines:
  line=raw.strip().replace('Encarnacion-StrandCincinnati','Encarnacion-Strand Cincinnati')
  if line==end:break
  if not line:continue
  m=re.match('^('+prefix+r'\d{1,3})\s+(.+)$',line)
  if not m:
   if line.isupper() and not line.startswith('SUBJECT') and not re.match(r'^\d{4} TOPPS',line):context=line.title()
   continue
  number,rest=m.groups();star='*' in rest;rest=rest.replace('*','').strip();rest=re.sub(r'[®™]','',rest)
  affiliation=''
  league=re.match(r'^(.*?)\s+(Major League Baseball|American League|National League)\s*(.*)$',rest)
  if league:player,affiliation,note=league.groups();team=''
  elif rest in teams:player=team=rest;note=''
  else:
   t=team_re.match(rest)
   if not t:errors.append({'id':id,'line':line});continue
   player,team,note=t.groups();team=next(x for x in teams if x.lower()==team.lower())
  note=' · '.join(x for x in [note,affiliation,context if context not in ['Base','Base Cards','Base Card Set','Base Set','Veterans','Base Cards I','Base Cards Ii'] else '', 'Short print (publisher asterisk)' if star else ''] if x)
  subject={'name':player,'team':team,**({'note':note} if note else {})}
  if number not in rows:rows[number]={'id':id+'-'+number.lower(),'cardNumber':number,'section':'Base','variant':'Base','subjects':[]}
  if affiliation:rows[number]['sourceAffiliation']=affiliation
  if subject not in rows[number]['subjects']:rows[number]['subjects'].append(subject)
 expected={prefix+str(i) for i in range(lo,hi+1)}
 if set(rows)!=expected:errors.append({'id':id,'missing':sorted(expected-set(rows)),'extra':sorted(set(rows)-expected)})
 for c in rows.values():c['player']=' / '.join(s['name'] for s in c['subjects']);c['team']=' / '.join(dict.fromkeys(s['team'] for s in c['subjects'] if s['team'])) or c.get('sourceAffiliation','')
 name=src['name'].replace('Topps Baseball Series 1','Topps Series 1 Baseball').replace('Topps Baseball Series 2','Topps Series 2 Baseball').replace('Topps Update Baseball','Topps Update Series Baseball')
 sets.append({'id':id,'year':int(id[:4]),'sport':'baseball','brand':'Topps','setName':name,'displayName':name,'scope':'Official base section only. Multi-player entries preserve all printed subjects. Variations and insert sections remain separate; see the publisher master PDF.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':[],'sourceUrl':src['url'],'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'cards':sorted(rows.values(),key=lambda c:int(c['cardNumber'].replace(prefix,'')))})
(root/'parse-review.json').write_text(json.dumps({'errors':errors,'sets':[{'id':s['id'],'cards':s['cardCount'],'multiPlayer':sum(len(c['subjects'])>1 for c in s['cards'])} for s in sets]},ensure_ascii=False,indent=2),encoding='utf-8')
if errors:print(json.dumps(errors,ensure_ascii=False));raise SystemExit(1)
Path('scripts/topps/baseball-stocked-current-2026-10.mjs').write_bytes(('// Verified publisher base sections; historical subjects and source footnotes retained.\nexport const baseballStockedCurrentSets = '+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps([(s['id'],s['cardCount']) for s in sets]))