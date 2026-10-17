// Exact columns checked visually against page 1 of the official publisher PDF.
export const baseballOdds={
 '2023-topps-series-2':{
  source:'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023ToppsSeries2Odds.pdf',
  sourcePage:1,checked:'2026-10-17',
  formats:['5191 — Hobby pack','5192 — HTA Jumbo pack'],
  rows:[{name:'Base Gold',odds:[18,5]},{name:'Base Rainbow Foil',odds:[10,2]},{name:'Base Vintage Stock',odds:[363,105]},{name:'Base Super Short Prints',odds:[469,136]}]
 }
};
export function baseballOddsHtml(setId,esc){
 const data=baseballOdds[setId];if(!data)return '';
 return '<section><h2>Official pack-odds examples</h2><p>These are category odds for the exact pack formats shown, not the odds of one named player. Hobby and Jumbo packs have different contents. The table uses pack columns, not box columns; a published rate is not a promise for your next pack.</p><div style="overflow-x:auto"><table><thead><tr><th scope="col">Card category</th>'+data.formats.map(f=>'<th scope="col">'+esc(f)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(r=>'<tr><th scope="row">'+esc(r.name)+'</th>'+r.odds.map(n=>'<td>1 in '+n.toLocaleString('en-US')+' packs</td>').join('')+'</tr>').join('')+'</tbody></table></div><p><a href="'+esc(data.source)+'">Official Topps odds PDF</a>, page '+data.sourcePage+'. Other configurations and categories are in the publisher sheet. Checked '+data.checked+'.</p></section>';
}
