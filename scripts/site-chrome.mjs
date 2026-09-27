// The real Webflow navbar and footer for Worker-rendered pages (articles,
// items, categories, FAQ, books, preorders, MTG). The Worker reads them from
// a plain published Webflow page, so editing the nav in Webflow updates these
// pages too instead of them keeping a hand-copied menu.
//
// Pulled from the page: the <html> data-wf-* attributes (Webflow's runtime
// needs them), the <head> stylesheets/scripts, the #navbarID navbar, the
// .footer-section footer, and every script after the footer (jQuery,
// webflow.js, the site-wide footer code with wo-ui.js). Titles, meta tags,
// canonical links and JSON-LD stay the Worker page's own.

export const SITE_CHROME_SOURCE = 'https://www.themanapocket.com/privacy-policy';

// The whole element starting at `start`: counts nested <div>s until the one
// opened at `start` closes. Webflow's navbar and footer roots are both divs.
export function balancedDiv(html, start) {
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 0, m;
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { html: html.slice(start, tag.lastIndex), end: tag.lastIndex };
  }
  return null;
}

function openingDivAt(html, index) {
  const start = html.lastIndexOf('<div', index);
  return start >= 0 && html.indexOf('>', start) > index ? start : -1;
}

export function extractSiteChrome(page) {
  const html = String(page || '');
  const navAt = html.search(/\bid="navbarID"/);
  if (navAt < 0) return null;
  const navStart = openingDivAt(html, navAt);
  const nav = navStart >= 0 ? balancedDiv(html, navStart) : null;
  if (!nav) return null;

  const footerMatch = /<div\b[^>]*class="(?:[^"]*\s)?footer-section(?:\s[^"]*)?"[^>]*>/i.exec(html.slice(nav.end));
  const footer = footerMatch ? balancedDiv(html, nav.end + footerMatch.index) : null;

  const bodyClose = html.lastIndexOf('</body>');
  const scriptsFrom = footer ? footer.end : nav.end;
  const tail = bodyClose > scriptsFrom ? html.slice(scriptsFrom, bodyClose) : '';
  // Only the scripts and styles after the footer: never page content.
  const bodyEnd = (tail.match(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>/gi) || []).join('');

  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = (headMatch ? headMatch[1] : '')
    .replace(/<title\b[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, '')
    .replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '')
    .trim();

  const htmlTag = /<html\b([^>]*)>/i.exec(html);
  const htmlAttrs = ((htmlTag ? htmlTag[1] : '').match(/\sdata-wf-[\w-]+="[^"]*"/g) || []).join('');

  return { htmlAttrs, head, nav: nav.html, footer: footer ? footer.html : '', bodyEnd };
}
