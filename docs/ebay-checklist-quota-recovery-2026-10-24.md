# eBay checklist quota recovery — October 24, 2026

The live photo routes returned eBay HTTP 429. Do not assume a daily quota reset time from that status alone.

## Changes

- Checklist HTML requests only read saved marketplace results. They no longer start a search in `waitUntil` when a crawler or customer opens a reference page.
- Visible-card JSON requests refresh results after three hours instead of fifteen minutes. The existing two-concurrent-lookups browser queue remains.
- Successful listing results remain available during a brief failure for at most five hours and fifty-five minutes. Ended auctions are filtered out. This stays within the six-hour listing-data display window in eBay's API License Agreement. Price check times remain visible.
- A Browse 429 triggers one cached Developer Analytics lookup through the existing application token. It uses `api_context=buy&api_name=browse`; no new credentials or scopes are introduced.
- Analytics data is allowlisted to resource name, limit, count, remaining, reset and window. It is cached for five minutes, including retry backoff on failure.
- A verified exhausted search quota pauses photo searches until its reported reset plus five seconds. Otherwise the pause uses `Retry-After` or at least five minutes.
- Public photo responses expose only retry time and exhaustion state, not usage counts or credentials. The existing owner/admin-protected `/ebay/status` can read the cached counts; `?usage=1` requests a bounded refresh.

## Verification

Tests cover no searches from HTML requests, exact base/parallel identity, cached usage diagnostics, unknown versus zero quota values, unrelated method quotas, reported reset times, Retry-After, recent data during an outage, expired-auction rejection, and the six-hour hard cutoff.

## Account follow-up

The eBay Developers Program tab requires its separate developer login. Regular eBay sign-in does not establish a developer session. A higher-limit application has not been submitted.

Sources:

- https://developer.ebay.com/develop/api/buy/developer_analytics_api
- https://www.ebay.co.jp/developer/api/analytics_api/documentation
- https://developer.ebay.com/join/api-license-agreement
- https://developer.ebay.com/grow/application-growth-check
