import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// A real near-miss: a code comment added this session contained the literal
// text "<script>window.print()</script>", unescaped. The HTML parser
// doesn't understand JS comments/strings -- it ends a <script> element the
// instant it sees the literal bytes "</script>" ANYWHERE in its content, so
// that one comment would have silently truncated the entire main inline
// application script in the browser right there, dropping everything after
// it with no error at page load. Every other place in this file that needs
// to write out that string escapes it as "<\/script>" specifically to avoid
// this; this guards against a future comment/string missing that escape.

const scriptOpen = html.indexOf('<script>');
assert.ok(scriptOpen !== -1, 'could not find the main inline <script> tag');
const scriptClose = html.indexOf('</script>', scriptOpen);
assert.ok(scriptClose !== -1, 'could not find a closing </script>');
const body = html.slice(scriptOpen + '<script>'.length, scriptClose);

// The main application script is enormous (tens of thousands of lines) --
// a premature truncation from a stray unescaped </script> would produce a
// drastically shorter extract than the real thing.
assert.ok(body.length > 500000, `main inline <script> body is only ${body.length} chars -- something is terminating it early (a literal, unescaped </script> inside a comment or string)`);

// And whatever survives to this point must still be syntactically valid on
// its own (a truncation that happens to land mid-statement, not just
// mid-comment, throws here).
assert.doesNotThrow(() => new Function(body), 'the main inline <script> body must parse as valid JS up to its real closing tag');

console.log('Dashboard main script integrity checks passed');
