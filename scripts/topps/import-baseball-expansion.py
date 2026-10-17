"""Strict numeric-base imports from the exact publisher PDFs listed below."""
import ast,hashlib,json,re,sys
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path('../outputs/baseball-checklists-2023-up')
original=Path(__file__).with_name('import-2023-baseball.py')
tree=ast.parse(original.read_text(encoding='utf8'))
teams=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='teams' for t in n.targets))+['Cleveland Indians']
team_re=re.compile(r'^(.*?)\s+('+ '|'.join(re.escape(t) for t in sorted(teams,key=len,reverse=True)) +r')[®™]?(?:\s+(.*))?$')
specs=[('2019-topps-chrome',2019,'Topps','2019 Topps Chrome Baseball',204,'2019ToppsChromeBBCL.pdf'),('2023-bowman',2023,'Bowman','2023 Bowman Baseball',100,'2023BowmanBaseballChecklist.pdf'),('2023-bowman-chrome',2023,'Bowman','2023 Bowman Chrome Baseball',100,'MLB2308-2023BowmanChromeBaseballChecklist.pdf'),('2023-topps-chrome',2023,'Topps','2023 Topps Chrome Baseball',220,'MLB2326-2023ToppsChromeBaseballChecklist.pdf')]
sets=[]
for id,year,brand,name,count,pdf in specs:
    rows={};started=False
    for raw in (root/(id+'.txt')).read_text(encoding='utf8').splitlines():
        line=raw.strip();m=re.match(r'^(\d+)\s*(.+)$',line)
        if not m:
            if started and line:break
            continue
        no,rest=m.groups()
        if not 1<=int(no)<=count:raise ValueError((id,'unexpected base number',no))
        parsed=team_re.match(rest)
        if not parsed:raise ValueError((id,'unrecognized row',line))
        if no in rows:raise ValueError((id,'unexpected repeated base number',no))
        player,team,note=parsed.groups();started=True
        rows[no]={'id':id+'-'+no,'cardNumber':no,'section':'Base','variant':'Base','player':player,'team':team,'subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]}
    if set(rows)!={str(i) for i in range(1,count+1)}:raise ValueError((id,'incomplete base checklist',len(rows),count))
    sets.append({'id':id,'year':year,'sport':'baseball','brand':brand,'setName':name,'displayName':name,'scope':'Numeric base checklist only; prospect subsets, inserts, image variations and parallels are not included here. See the official publisher PDF.','licensedBaseball':True,'reviewed':True,'cardCount':len(rows),'unissuedNumbers':[],'sourceUrl':'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/'+pdf,'sourceSha256':hashlib.sha256((root/(id+'.pdf')).read_bytes()).hexdigest(),'cards':list(rows.values())})
Path(__file__).with_name('baseball-expansion.mjs').write_text('// Generated from exact official Topps PDF sources by import-baseball-expansion.py.\nexport const baseballExpansionSets = '+json.dumps(sets,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8',newline='\n')
print(json.dumps([{'set':s['setName'],'cards':s['cardCount']}for s in sets]))
