/**
 * Vercel Serverless Proxy — PW Web Player
 * @CODEXMOMO | t.me/CODEXUPDATEZ | github.com/codexmomoo
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const ALLOWED = [
    'studyuk.site',
    'deltastudy.site',
    'api.penpencil.co',
    'videos.penpencil.co',
    'd1d34p8vz63oiq.cloudfront.net',
    'pw.live',
    'akamaized.net',
    'cloudfront.net',
  ];

  const hostname = new URL(targetUrl).hostname;
  const allowed = ALLOWED.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!allowed) return res.status(403).json({ error: `Domain not allowed: ${hostname}` });

  const isPenpencil = hostname.includes('penpencil.co');
  const isDelta = hostname.includes('deltastudy.site');

  const upstreamHeaders = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'client-id': '5eb393ee95fab7468a79d189',
    'user-agent': 'Android',
    'Connection': 'keep-alive',
  };

  if (req.headers['authorization']) upstreamHeaders['Authorization'] = req.headers['authorization'];
  if (req.headers['content-type']) upstreamHeaders['Content-Type'] = req.headers['content-type'];

  if (isPenpencil) {
    upstreamHeaders['Origin'] = 'https://www.pw.live';
    upstreamHeaders['Referer'] = 'https://www.pw.live/';
  } else if (isDelta) {
    upstreamHeaders['Origin'] = 'https://deltastudy.site';
    upstreamHeaders['Referer'] = 'https://deltastudy.site/';
  } else {
    upstreamHeaders['Origin'] = 'https://studyuk.site';
    upstreamHeaders['Referer'] = 'https://studyuk.site/';
  }

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let response;
  try {
    response = await fetch(targetUrl, { method: req.method, headers: upstreamHeaders, body, redirect: 'follow' });
  } catch (err) {
    return res.status(502).json({ error: `Fetch failed: ${err.message}` });
  }

  const contentType = response.headers.get('content-type') || '';

  // HTML response = server down/error — return special status
  const isHtml = contentType.includes('text/html') || (await (async () => {
    // Peek at response text for HTML detection
    return false;
  })());

  const isM3u8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl');
  if (isM3u8) {
    let text;
    try { text = await response.text(); } catch (err) { return res.status(502).json({ error: `M3U8 error: ${err.message}` }); }
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const pp = '/api/proxy?url=';
    text = text.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
      const t = line.trim(); if (!t) return line;
      const abs = t.startsWith('http') ? t : baseUrl + t;
      return pp + encodeURIComponent(abs);
    });
    text = text.replace(/URI="([^"]+)"/g, (_, uri) => {
      const abs = uri.startsWith('http') ? uri : baseUrl + uri;
      return `URI="${pp + encodeURIComponent(abs)}"`;
    });
    text = text.replace(/EXT-X-MAP:URI="([^"]+)"/g, (_, uri) => {
      const abs = uri.startsWith('http') ? uri : baseUrl + uri;
      return `EXT-X-MAP:URI="${pp + encodeURIComponent(abs)}"`;
    });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(response.status).send(text);
  }

  let finalCT = contentType;
  if (targetUrl.includes('.ts')) finalCT = 'video/mp2t';
  else if (targetUrl.includes('.m4s')) finalCT = 'video/iso.segment';
  else if (targetUrl.includes('.mp4')) finalCT = 'video/mp4';
  else if (targetUrl.includes('.key')) finalCT = 'application/octet-stream';

  if (contentType.includes('application/json')) {
    let json;
    try { json = await response.json(); } catch { const t = await response.text(); return res.status(response.status).send(t); }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(response.status).json(json);
  }

  // Text response check — detect HTML = server down
  if (contentType.includes('text/html')) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(503).json({ success: false, error: 'server_down', message: 'Server returned HTML — likely down or blocked' });
  }

  let buffer;
  try { buffer = await response.arrayBuffer(); } catch (err) { return res.status(502).json({ error: `Buffer error: ${err.message}` }); }
  res.setHeader('Content-Type', finalCT || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(response.status).send(Buffer.from(buffer));
}
