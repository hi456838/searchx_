const maxBodyBytes = 2048;
const maxQueryLength = 240;

export async function serveAiSearch(request, response) {
  function send(status, body) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(body));
  }

  if (request.method !== 'POST') {
    send(405, { error: 'method_not_allowed' });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    send(503, { error: 'ai_not_configured' });
    return;
  }

  let query;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) {
        send(413, { error: 'query_too_large' });
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    query = JSON.parse(Buffer.concat(chunks).toString('utf8')).query?.trim();
  } catch {
    send(400, { error: 'invalid_query' });
    return;
  }
  if (!query || query.length > maxQueryLength) {
    send(400, { error: 'invalid_query' });
    return;
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(9000),
      body: JSON.stringify({
        model: process.env.OPENAI_SEARCH_MODEL || 'gpt-4.1-mini',
        store: false,
        max_output_tokens: 200,
        instructions: [
          'Interpret searches for a public astronomical sky map.',
          'When a request uniquely describes a fixed astronomical object, return one recognizable CDS Sesame object name or catalog ID as target.',
          'Never return coordinates. For ambiguous targets ask one short clarifying question in message. For moving targets explain that this search supports fixed objects.',
          'For a general astronomy question give a brief answer in message, without a target. If unsure say so. Reject unrelated requests briefly.',
        ].join(' '),
        input: query,
        text: { format: {
          type: 'json_schema',
          name: 'sky_search',
          strict: true,
          schema: {
            type: 'object',
            properties: { target: { type: ['string', 'null'] }, message: { type: 'string' } },
            required: ['target', 'message'],
            additionalProperties: false,
          },
        } },
      }),
    });
    if (!upstream.ok) throw new Error('Model request failed');
    const { output } = await upstream.json();
    const content = output?.find(item => item.type === 'message')?.content
      ?.find(item => item.type === 'output_text');
    const result = JSON.parse(content?.text);
    const target = typeof result.target === 'string' ? result.target.trim() : '';
    if (target && (!/^[a-zA-Z0-9 +._-]{1,80}$/.test(target) || !/[a-zA-Z]/.test(target))) {
      throw new Error('Invalid catalog target');
    }
    send(200, { target: target || null, message: String(result.message ?? '').slice(0, 500) });
  } catch {
    send(502, { error: 'ai_unavailable' });
  }
}
