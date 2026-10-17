// Existing public GA4 stream. Never include customer or private inventory fields.
export const measurementId='G-BFJX6M394W';
export const googleAnalyticsTag=`<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script><script>window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());window.gtag('config','${measurementId}');</script>`;
export function productViewAnalytics(item){
  if(!item?.id||!item.name)return '';
  const price=Number(item.price);
  const product={item_id:String(item.id),item_name:String(item.name),item_category:String(item.category||''),quantity:1,...(price>0?{price}:{})};
  const payload=JSON.stringify({currency:'USD',...(price>0?{value:price}:{}),items:[product]}).replace(/</g,'\\u003c');
  return `<script data-mp-product-view>(function(){if(typeof window.gtag==='function')window.gtag('event','view_item',${payload});})();</script>`;
}
