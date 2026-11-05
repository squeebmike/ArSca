"""Parse preserved official November 2026 PDF text; pass the source directory.
Use pdfplumber extract_text(x_tolerance=2), retain source PDFs for hash validation.
No provider collection or image/price requests. Shared printed numbers retain subjects.
"""
from pathlib import Path
import re, json, hashlib, sys
r=Path(sys.argv[1])
slug=lambda x:re.sub(r'[^a-z0-9]+','-',x.lower()).strip('-')
nbateams=['Atlanta Hawks','Boston Celtics','Brooklyn Nets','Charlotte Hornets','Chicago Bulls','Cleveland Cavaliers','Dallas Mavericks','Denver Nuggets','Detroit Pistons','Golden State Warriors','Houston Rockets','Indiana Pacers','Los Angeles Clippers','Los Angeles Lakers','Memphis Grizzlies','Miami Heat','Milwaukee Bucks','Minnesota Timberwolves','New Orleans Pelicans','New York Knicks','Oklahoma City Thunder','Orlando Magic','Philadelphia 76ers','Phoenix Suns','Portland Trail Blazers','Sacramento Kings','San Antonio Spurs','Toronto Raptors','Utah Jazz','Washington Wizards','Seattle Supersonics','Seattle SuperSonics','New Jersey Nets','Vancouver Grizzlies','New Orleans Hornets','Charlotte Bobcats','Washington Bullets','Kansas City Kings','San Diego Clippers','Team USA','USA']
mlbteams=['Los Angeles Dodgers','Houston Astros','Angels','California Angels','Kansas City Royals','New York Mets','Cleveland Guardians','Seattle Mariners','Philadelphia Phillies','Chicago Cubs','Atlanta Braves','Cincinnati Reds','Tampa Bay Rays','Milwaukee Brewers','Chicago White Sox','Pittsburgh Pirates','Washington Nationals','Baltimore Orioles','Miami Marlins','Athletics','New York Yankees','St. Louis Cardinals','Texas Rangers','Colorado Rockies','Boston Red Sox','San Diego Padres','Arizona Diamondbacks','San Francisco Giants','Toronto Blue Jays','Minnesota Twins','Detroit Tigers','Brooklyn Dodgers','Oakland Athletics','Montreal Expos','Cleveland Indians']
spec=[('cosmic','2026-topps-cosmic-chrome-baseball','2026 Topps Cosmic Chrome Baseball','baseball','2026-11-04',200,'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Cosmic_Chrome_Baseball_-_Checklist.pdf?v=1790609925'),('basketball','2026-27-topps-flagship-basketball','2026–27 Topps Flagship Basketball','basketball','2026-11-05',300,'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/Copy_of_2026-27_Topps_Flagship_Basketball_Checklist_10-9-26.xls_-_Compatibility_Mode.pdf?v=1791570579')]
sets=[];errors=[]
for file,id,name,sport,date,count,url in spec:
 teams=mlbteams if sport=='baseball' else nbateams;rx=re.compile(r'^(.*?)\s*('+ '|'.join(re.escape(x)for x in sorted(teams,key=len,reverse=True))+r')(?:[®™])?(?:\s+(.*))?$');groups={};group=None;kind='Base';printed=0
 for line in (r/(file+'-plumber.txt')).read_text(encoding='utf-8').splitlines():
  line=line.strip()
  if not line or line.startswith(('Checklists provided','the time of','time of')):continue
  if line in ['BASE','INSERT','AUTOGRAPH','RELIC']:kind={'BASE':'Base','INSERT':'Insert','AUTOGRAPH':'Autograph','RELIC':'Relic'}[line];continue
  m=re.match(r'^(\d+|[A-Z0-9]+-[A-Z0-9-]+)\s+(.+)$',line)
  if not m or (line==line.upper() and not re.match(r'^[A-Z0-9]+-[A-Z0-9-]+\s',line)):
   if line!=line.upper():errors.append((file,'unknown heading',line));continue
   group=line;groups.setdefault(group,{'name':group.title(),'id':slug(group),'kind':kind,'cards':{}});continue
  num,rest=m.groups();printed+=1;parsed=rx.match(rest)
  if parsed:player,team,note=parsed.groups()
  elif group=='COSMIC EXPLORERS CUT SIGNATURES':player,team,note=rest,'',None
  else:errors.append((file,group,line));continue
  g=groups[group];card=g['cards'].setdefault(num,{'id':id+('-' if group=='BASE CARDS' else '-'+g['id']+'-')+slug(num),'cardNumber':num,'section':'Base' if group=='BASE CARDS' else g['name'],'variant':'Base' if group=='BASE CARDS' else g['name'],'subjects':[]})
  sub={'name':player,'team':team,**({'note':note}if note else {})}
  if sub in card['subjects']:errors.append((file,'duplicate subject',line))
  card['subjects'].append(sub)
 for g in groups.values():
  g['cards']=list(g['cards'].values())
  for c in g['cards']:c['player']=' / '.join(s['name']for s in c['subjects']);c['team']=' / '.join(dict.fromkeys(s['team']for s in c['subjects']if s['team']))
 base=groups.pop('BASE CARDS')['cards'];assert [int(c['cardNumber'])for c in base]==list(range(1,count+1))
 s={'id':id,'year':2026,'releaseDate':date,'sport':sport,'brand':'Topps','setName':name,'displayName':name,'reviewed':True,'parallelReviewPending':True,'sourceUrl':url,'sourceSha256':hashlib.sha256((r/(file+'.pdf')).read_bytes()).hexdigest(),'cardCount':len(base),'cards':base,'sections':list(groups.values()),'scope':'Numbered base, insert, variation, autograph and relic checklists from the official publisher PDF. Shared-number cards retain every printed subject. Unnumbered parallel programs are not included. Photos and prices are separate references.','unissuedNumbers':[]}
 if sport=='baseball':s['licensedBaseball']=True
 else:s.update(season='2026-27',licensed=True,licensingEvidence={'verified':True,'releaseYear':2026,'licensors':['NBA','NBPA'],'sourceUrl':'https://www.nba.com/news/fanatics-nba-nbpa-multiyear-partnership'})
 sets.append(s);print(file,'base',len(base),'sections',len(s['sections']),'numbered cards',len(base)+sum(len(g['cards'])for g in s['sections']),'printed rows',printed)
assert not errors,errors;print('ERRORS',len(errors));print(json.dumps(errors,ensure_ascii=True)[:6000]);(r/'parsed-sports.json').write_bytes(json.dumps(sets,ensure_ascii=False).encode('utf-8'))
