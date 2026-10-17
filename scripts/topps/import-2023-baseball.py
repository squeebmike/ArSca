import json,re,hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path('../outputs/baseball-checklists-2023-up')
teams=['Arizona Diamondbacks','Atlanta Braves','Baltimore Orioles','Boston Red Sox','Chicago Cubs','Chicago White Sox','Cincinnati Reds','Cleveland Guardians','Colorado Rockies','Detroit Tigers','Houston Astros','Kansas City Royals','Los Angeles Angels','Angels','Los Angeles Dodgers','Miami Marlins','Milwaukee Brewers','Minnesota Twins','New York Mets','New York Yankees','Oakland Athletics','Philadelphia Phillies','Pittsburgh Pirates','San Diego Padres','San Francisco Giants','Seattle Mariners','St. Louis Cardinals','Tampa Bay Rays','Texas Rangers','Toronto Blue Jays','Washington Nationals']
team_re=re.compile(r'^(.*?)\s+('+ '|'.join(re.escape(t) for t in sorted(teams,key=len,reverse=True)) +r')[®™]?(?:\s+(.*))?$')
specs=[('series-1','Series 1',1,330,'2023ToppsSeries1BaseballChecklistV2.pdf'),('series-2','Series 2',331,660,'MLB2302-2023ToppsSeries2BBChecklistFinalv2.pdf'),('update','Update Series',1,330,'MLB2303-2023ToppsUpdateSeriesBBChecklistFinal_20-Revised.pdf')]
sets=[]
for file,label,start,end,pdf in specs:
    rows={}; unissued=[]; started=False
    for raw in (root/(file+'.txt')).read_text(encoding='utf8').splitlines():
        line=raw.strip(); m=re.match(r'^(US\d+|\d+)\s+(.+)$',line)
        if not m:
            if started and line: break
            continue
        no,rest=m.groups()
        if file=='update' and not no.startswith('US'): break
        value=int(no.removeprefix('US'))
        if value<start or value>end: break
        if rest=='DOES NOT EXIST':
            unissued.append(no)
            continue
        parsed=team_re.match(rest)
        if not parsed: raise ValueError((file,line))
        player,team,note=parsed.groups();started=True
        row=rows.setdefault(no,{'id':file+'-'+no.lower(),'cardNumber':no,'section':'Base','variant':'Base','subjects':[]})
        row['subjects'].append({'name':player,'team':team,**({'note':note} if note else {})})
    expected={('US' if file=='update' else '')+str(i) for i in range(start,end+1)}
    if set(rows)!=expected-set(unissued): raise ValueError((file,'missing',sorted(expected-set(unissued)-set(rows))))
    for row in rows.values():
        row['player']=' / '.join(dict.fromkeys(s['name'] for s in row['subjects']))
        row['team']=' / '.join(dict.fromkeys(s['team'] for s in row['subjects']))
    sets.append({'id':'2023-topps-'+file,'year':2023,'sport':'baseball','brand':'Topps','setName':'2023 Topps '+label+' Baseball','displayName':'2023 Topps '+label+' Baseball','scope':'Base checklist only; inserts and parallels are in the official publisher PDF.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':unissued,'sourceUrl':'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/'+pdf,'sourceSha256':hashlib.sha256((root/(file+'.pdf')).read_bytes()).hexdigest(),'cards':list(rows.values())})
out=Path(__file__).with_name('baseball-seed.mjs')
out.write_text('// Generated from official Topps PDFs by scripts/topps/import-2023-baseball.py. Base checklist scope is explicit.\nimport {baseballExpansionSets} from "./baseball-expansion.mjs";\nexport const baseballSets = [...'+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+',...baseballExpansionSets];\n',encoding='utf8',newline='\n')
print(json.dumps([{'set':s['setName'],'cards':len(s['cards'])} for s in sets]))
