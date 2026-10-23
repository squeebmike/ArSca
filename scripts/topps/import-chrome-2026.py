"""Import the complete numbered base list from the official 2026 Chrome PDF."""
from pathlib import Path
import json,re,hashlib
exec(Path('scripts/topps/import-stocked-checklists.py').read_text(encoding='utf-8').split('counts=')[0])
root=Path('../outputs/next-topps-sources')
source=json.loads((root/'manifest.json').read_text(encoding='utf-8'))[0]
pdf=Path(source['file'])
assert hashlib.sha256(pdf.read_bytes()).hexdigest()==source['sha256']
lines=(root/'2026-topps-chrome-baseball.txt').read_text(encoding='utf-8').splitlines()
start=lines.index('BASE CARDS')+1;end=lines.index('INSERT',start)
cards=[];set_id='2026-topps-chrome-baseball'
for line in lines[start:end]:
 line=line.strip()
 if not line or line.startswith(('Checklists provided by Topps','production, but actual contents')):continue
 match=re.fullmatch(r'(\d+)\s+(.+)',line)
 assert match,line
 number,rest=match.groups();subject=team_re.fullmatch(rest)
 assert subject,line
 player,team,note=subject.groups()
 cards.append({'id':set_id+'-'+number,'cardNumber':number,'player':player,'team':team,'section':'Base','variant':'Base','subjects':[{'name':player,'team':team,**({'note':note} if note else {})}]})
assert len(cards)==300
assert {c['cardNumber'] for c in cards}=={str(n) for n in range(1,301)}
release={'id':set_id,'year':2026,'sport':'baseball','brand':'Topps','setName':'2026 Topps Chrome Baseball','displayName':'2026 Topps Chrome Baseball','scope':'Verified official publisher checklist. Inserts and variations are listed separately.','licensedBaseball':True,'reviewed':True,'cardCount':300,'unissuedNumbers':[],'sourceUrl':source['sourceUrl'],'sourceSha256':source['sha256'],'cards':cards}
Path('scripts/topps/baseball-chrome-2026.mjs').write_bytes(('// Generated from the verified official Topps checklist by import-chrome-2026.py.\nexport const baseballChrome2026Sets='+json.dumps([release],ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps({'set':set_id,'baseCards':len(cards),'first':cards[0]['player'],'last':cards[-1]['player']}))
