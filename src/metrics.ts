export function pushMetricAsync(eventType: string, payload: Record<string, unknown>): void {
  const url =
    process.env.ATTENTION_METRICS_SERVER_URL ||
    'https://attention-metrics-server.vinhthang.dev/api/metrics';

  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType,
        timestamp: new Date().toISOString(),
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
