// Configuration columns visually checked against pages 1 and 10 of Topps' PDF.
export const footballOdds={
 '2025-topps-chrome-football':{
  source:'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Chrome_Football_Odds.pdf?v=1787966316',checked:'2026-10-21',
  formats:['6390 · Hobby Distributor','6392 · HTA Jumbo Hobby Distributor','6393 · Breaker Delight Hobby Distributor','6402 · Hanger Box EA HH'],
  rows:[
   {name:'Base Refractor',page:1,odds:['1:4','1:2','1:1','1:1']},
   {name:'Base Gold Refractor',page:1,odds:['1:696','1:244','1:66','1:576']},
   {name:'Helix',page:10,odds:['1:2,559','1:859','1:72','1:4,813']},
   {name:'Game Genies',page:10,odds:['1:928','1:372','1:24',null]},
   {name:'Tecmo Autographs',page:10,odds:['1:36,405','1:6,408','1:632',null]},
   {name:'Kaiju',page:10,odds:['1:2,319','1:929','1:58',null]},
   {name:'Ultraviolet',page:10,odds:['1:1,160','1:464','1:29','1:618']}
  ]
 }
};
export function footballOddsHtml(setId,escape){
 const data=footballOdds[setId];if(!data)return '';
 return '<p>Choose your exact configuration. These are selected category ratios from the publisher’s columns, not odds for one named player or guaranteed hits. Do not convert a pack ratio into a per-box promise.</p>'+data.formats.map((format,index)=>'<details name="sports-odds-format"'+(index===0?' open':'')+'><summary>'+escape(format)+'</summary><dl>'+data.rows.map(row=>'<dt>'+escape(row.name)+'</dt><dd>'+(row.odds[index]?'Published ratio '+escape(row.odds[index]):'— Not listed in this publisher column')+' <small>(PDF p. '+row.page+')</small></dd>').join('')+'</dl></details>').join('')+'<p><a href="'+escape(data.source)+'">Full official Topps odds PDF</a> · checked '+data.checked+'. Other categories and configurations remain in the source sheet.</p>';
}
