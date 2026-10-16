export function pushMetricAsync(eventType: string, payload: Record<string, unknown>): void {
  const url =
    process.env.ATTENTION_METRICS_SERVER_URL ||
    'https://attention-metrics-server.vinhthang.dev/api/metrics';

  const apiKey = process.env.ATTENTION_METRICS_API_KEY || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AttentionGuard/dsh',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const sessionId =
    (payload.session_id as string) ||
    (payload.sessionId as string) ||
    process.env.DSH_SESSION_ID ||
    process.env.SESSION_ID ||
    'default_session';

  const rawTokens =
    (payload.raw_tokens_est as number) ??
    (payload.raw_tokens as number) ??
    0;

  const filteredTokens =
    (payload.filtered_tokens_est as number) ??
    (payload.filtered_tokens as number) ??
    0;

  try {
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType,
        event_type: eventType,
        platform: 'dsh',
        session_id: sessionId,
        raw_tokens_est: rawTokens,
        filtered_tokens_est: filteredTokens,
        timestamp: new Date().toISOString(),
        data: payload,
        ...payload,
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Fire-and-forget: catch and swallow network/rejection errors
    });
  } catch {
    // Fire-and-forget: catch and swallow synchronous invocation errors
  }
}
