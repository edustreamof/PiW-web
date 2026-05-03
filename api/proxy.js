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

  try {
    // ✅ MOD APK STYLE HEADERS — exact working headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'client-id': '5eb393ee95fab7468a79d189',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': targetUrl.startsWith('https://api.penpencil.co') ? 'https://www.pw.live' : 'https://studyuk.site',
      'Referer': targetUrl.startsWith('https://api.penpencil.co') ? 'https://www.pw.live/' : 'https://studyuk.site/',
      'Connection': 'keep-alive',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    };

    // ✅ Forward Authorization token
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    // ✅ Forward Content-Type for POST bodies
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    // ✅ Body handling for POST/PUT
    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';

    // ✅ M3U8 rewrite for HLS streams
    if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
      let text = await response.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const proxyBase = '/api/proxy?url=';
      const cleanBaseUrl = baseUrl.split('?')[0];

      text = text.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
        line = line.trim();
        if (!line || line.startsWith('#')) return line;
        let segmentUrl = line.startsWith('http') ? line : cleanBaseUrl + line;
        return proxyBase + encodeURIComponent(segmentUrl);
      });

      text = text.replace(/URI="([^"]+)"/g, (match, uri) => {
        let keyUrl = uri.startsWith('http') ? uri : cleanBaseUrl + uri;
        return `URI="${proxyBase + encodeURIComponent(keyUrl)}"`;
      });

      text = text.replace(/EXT-X-MAP:URI="([^"]+)"/g, (match, uri) => {
        let mapUrl = uri.startsWith('http') ? uri : cleanBaseUrl + uri;
        return `EXT-X-MAP:URI="${proxyBase + encodeURIComponent(mapUrl)}"`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(text);
    }

    // ✅ JSON passthrough
    if (contentType.includes('application/json')) {
      let json;
      try { json = await response.json(); } catch { const t = await response.text(); return res.status(response.status).send(t); }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json(json);
    }

    // ✅ Binary segments
    let finalContentType = contentType;
    if (targetUrl.includes('.ts')) finalContentType = 'video/mp2t';
    else if (targetUrl.includes('.m4s')) finalContentType = 'video/iso.segment';
    else if (targetUrl.includes('.mp4')) finalContentType = 'video/mp4';
    else if (targetUrl.includes('.key')) finalContentType = 'application/octet-stream';

    res.setHeader('Content-Type', finalContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
