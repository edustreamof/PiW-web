/**
 * Vercel Serverless Proxy — PW Web Player
 * @CODEXMOMO | t.me/CODEXUPDATEZ | github.com/codexmomoo
 *
 * Handles:
 *  - CORS for all external PW/penpencil domains
 *  - Authorization + client-id header forwarding
 *  - M3U8 segment URL rewriting for HLS playback
 *  - Binary passthrough for .ts / .m4s / .mp4 segments
 *  - EXT-X-KEY URI rewriting for encrypted HLS
 */

export default async function handler(req, res) {
  // ── CORS headers ────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Extract target URL ───────────────────────────────────────
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'url parameter required' });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // ── Domain allowlist ─────────────────────────────────────────
  const ALLOWED = [
    'studyuk.site',
    'api.penpencil.co',
    'videos.penpencil.co',
    'd1d34p8vz63oiq.cloudfront.net',
    'pw.live',
    'akamaized.net',
    'cloudfront.net',
  ];

  const hostname = new URL(targetUrl).hostname;
  const allowed = ALLOWED.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!allowed) {
    return res.status(403).json({ error: `Domain not allowed: ${hostname}` });
  }

  // ── Build upstream headers ───────────────────────────────────
  const isPenpencil = hostname.includes('penpencil.co');

  const upstreamHeaders = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    // client-id required by penpencil API
    'client-id': '5eb393ee95fab7468a79d189',
    // user-agent must be "Android" for penpencil endpoints
    'user-agent': 'Android',
    'Connection': 'keep-alive',
  };

  // ✅ Forward Authorization token (Bearer) — critical for api.penpencil.co
  if (req.headers['authorization']) {
    upstreamHeaders['Authorization'] = req.headers['authorization'];
  }

  // ✅ Forward Content-Type for POST bodies
  if (req.headers['content-type']) {
    upstreamHeaders['Content-Type'] = req.headers['content-type'];
  }

  // Origin/Referer — match domain to avoid CORS rejection by upstream
  if (isPenpencil) {
    upstreamHeaders['Origin'] = 'https://www.pw.live';
    upstreamHeaders['Referer'] = 'https://www.pw.live/';
  } else {
    upstreamHeaders['Origin'] = 'https://studyuk.site';
    upstreamHeaders['Referer'] = 'https://studyuk.site/';
  }

  // ── Build request body ───────────────────────────────────────
  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body) {
      body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    }
  }

  // ── Fetch upstream ───────────────────────────────────────────
  let response;
  try {
    response = await fetch(targetUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      redirect: 'follow',
    });
  } catch (err) {
    console.error('[proxy] Fetch error:', err.message);
    return res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
  }

  const contentType = response.headers.get('content-type') || '';

  // ── M3U8 / HLS playlist handling ────────────────────────────
  const isM3u8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl');
  if (isM3u8) {
    let text;
    try {
      text = await response.text();
    } catch (err) {
      return res.status(502).json({ error: `M3U8 read error: ${err.message}` });
    }

    // Base URL for resolving relative paths
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const proxyPrefix = '/api/proxy?url=';

    // ✅ Rewrite every non-comment line (segment/playlist URLs)
    text = text.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      const absoluteUrl = trimmed.startsWith('http')
        ? trimmed
        : baseUrl + trimmed;
      return proxyPrefix + encodeURIComponent(absoluteUrl);
    });

    // ✅ Rewrite EXT-X-KEY URI (encryption keys)
    text = text.replace(/URI="([^"]+)"/g, (match, uri) => {
      const absoluteUri = uri.startsWith('http') ? uri : baseUrl + uri;
      return `URI="${proxyPrefix + encodeURIComponent(absoluteUri)}"`;
    });

    // ✅ Rewrite EXT-X-MAP URI (init segments)
    text = text.replace(/EXT-X-MAP:URI="([^"]+)"/g, (match, uri) => {
      const absoluteUri = uri.startsWith('http') ? uri : baseUrl + uri;
      return `EXT-X-MAP:URI="${proxyPrefix + encodeURIComponent(absoluteUri)}"`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(response.status).send(text);
  }

  // ── Binary segments passthrough ──────────────────────────────
  let finalContentType = contentType;
  if (targetUrl.includes('.ts'))  finalContentType = 'video/mp2t';
  else if (targetUrl.includes('.m4s')) finalContentType = 'video/iso.segment';
  else if (targetUrl.includes('.mp4')) finalContentType = 'video/mp4';
  else if (targetUrl.includes('.key')) finalContentType = 'application/octet-stream';

  // ── JSON response passthrough ────────────────────────────────
  const isJson = contentType.includes('application/json') || finalContentType.includes('application/json');
  if (isJson) {
    let json;
    try {
      json = await response.json();
    } catch {
      const txt = await response.text();
      return res.status(response.status).send(txt);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(response.status).json(json);
  }

  // ── Default: binary passthrough ──────────────────────────────
  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (err) {
    return res.status(502).json({ error: `Buffer read error: ${err.message}` });
  }

  res.setHeader('Content-Type', finalContentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(response.status).send(Buffer.from(buffer));
}