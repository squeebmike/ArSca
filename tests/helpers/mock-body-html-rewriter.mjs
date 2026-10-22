// Small edge-API stand-in for body injection and approved script-src rewrites.
globalThis.HTMLRewriter = class {
  handlers=new Map();
  on(selector,handler){if(!['body','script[src]'].includes(selector))throw Error('Unsupported test selector');this.handlers.set(selector,handler);return this;}
  transform(response){
    const handlers=this.handlers;
    const body=new ReadableStream({async start(controller){
      let html=await response.text();
      const script=handlers.get('script[src]');
      if(script)html=html.replace(/<script\b[^>]*\bsrc="([^"]*)"[^>]*>/gi,(tag,src)=>{
        let value=src;script.element({getAttribute:name=>name==='src'?value:null,setAttribute(name,next){if(name==='src')value=next;}});
        return tag.replace(/\bsrc="[^"]*"/i,'src="'+value+'"');
      });
      let addition='';handlers.get('body')?.element({append(value){addition+=value;}});
      controller.enqueue(new TextEncoder().encode(html.replace('</body>',addition+'</body>')));controller.close();
    }});
    return new Response(body,{status:response.status,headers:response.headers});
  }
};
