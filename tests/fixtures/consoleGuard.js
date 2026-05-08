const DEFAULT_CONSOLE_ALLOW = [
  /favicon/i,
  /Failed to load resource.*favicon/i,
  /Supabase.*falling back/i,
  /PriceCharting.*temporarily/i,
];

async function installConsoleGuard(page, options = {}) {
  const errors = [];
  const failedRequests = [];
  const allow = [...DEFAULT_CONSOLE_ALLOW, ...(options.allowConsole || [])];
  const allowRequest = options.allowRequest || [];

  page.on('pageerror', error => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (allow.some(pattern => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });

  page.on('requestfailed', request => {
    const url = request.url();
    if (allowRequest.some(pattern => pattern.test(url))) return;
    failedRequests.push(`${request.method()} ${url}: ${request.failure()?.errorText || 'failed'}`);
  });

  return {
    errors,
    failedRequests,
    assertClean() {
      const combined = [...errors, ...failedRequests];
      if (combined.length) {
        throw new Error(`Browser errors detected:\n${combined.join('\n')}`);
      }
    },
  };
}

module.exports = { installConsoleGuard };
