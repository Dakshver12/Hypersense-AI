# Latency observability update

The admin API usage screen now surfaces the average server time for question-generation and scoring requests next to the existing request, provider, rate-limit, and fallback totals.

This value comes from the request telemetry already collected by the application. It does not include browser upload time or the user's network time. For an individual request, use the `Server-Timing` response header in browser DevTools → Network → request → Response Headers.

After applying the previous latency update, extract this incremental update over the repository root and reload `/admin/usage`. No database migration is required.
