// Minimal edge-API stand-in for tests that exercise body script injection.
globalThis.HTMLRewriter = class {
  on(selector, handler) { if (selector !== 'body') throw Error('Unsupported test selector'); this.handler = handler; return this; }
  transform(response) {
    let addition = ''; this.handler.element({ append(value) { addition += value; } });
    const body = new ReadableStream({ async start(controller) {
      const html = await response.text();
      controller.enqueue(new TextEncoder().encode(html.replace('</body>', addition + '</body>'))); controller.close();
    } });
    return new Response(body, { status: response.status, headers: response.headers });
  }
};
