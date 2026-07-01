(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ArsCaBarcode=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function validCheckDigit(value){
    const digits=String(value||'').split('').map(Number);
    if(![8,12,13].includes(digits.length)||digits.some(Number.isNaN))return false;
    const check=digits.pop();let sum=0;
    for(let i=digits.length-1,position=0;i>=0;i--,position++)sum+=digits[i]*(position%2===0?3:1);
    return (10-(sum%10))%10===check;
  }

  function normalizeBarcode(raw=''){
    const original=String(raw??'').trim();
    const digits=original.replace(/\D/g,'');
    let primary=digits,supplement='';
    if(digits.length===14||digits.length===15){primary=digits.slice(0,12);supplement=digits.slice(12);}
    else if(digits.length===17){primary=digits.slice(0,12);supplement=digits.slice(12);}
    else if(digits.length===18){primary=digits.slice(0,13);supplement=digits.slice(13);}
    const upcA=primary.length===12?primary:(primary.length===13&&primary.startsWith('0')?primary.slice(1):'');
    const ean13=primary.length===13?primary:(primary.length===12?'0'+primary:'');
    const upcE=primary.length===8?primary:'';
    const candidates=[upcA,ean13,upcE,primary].filter((value,index,list)=>value&&list.indexOf(value)===index);
    const typeGuess=primary.length===12?'UPC-A':primary.length===13?'EAN-13':primary.length===8?'UPC-E':'unknown';
    return {raw:original,cleaned:digits,primary,upcA,ean13,upcE,supplement,candidates,typeGuess,isValidLikely:[8,12,13].includes(primary.length)&&validCheckDigit(primary)};
  }

  return {normalizeBarcode,validCheckDigit};
});
