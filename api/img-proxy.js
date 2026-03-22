// ============================================================
// Vercel Function: /api/img-proxy
// WPサイトのホットリンク保護を回避して画像を配信
// Refererヘッダーを正規サイトに偽装してサーバー側で取得→転送
// ============================================================
export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  const { url } = req.query;
  if (!url) return res.status(400).end('url required');

  // 許可ドメインのみ（SSRFを防ぐ）
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).end('invalid url'); }
  if (!['xn--gcks1h8a0bzhrc.com'].includes(parsed.hostname)) {
    return res.status(403).end('forbidden domain');
  }
  // 拡張子チェック（画像のみ）
  if (!/\.(jpe?g|png|webp|gif|jpg)$/i.test(parsed.pathname)) {
    return res.status(403).end('image files only');
  }

  try {
    const imgRes = await fetch(url, {
      headers: {
        'Referer':     'https://xn--gcks1h8a0bzhrc.com/',
        'User-Agent':  'Mozilla/5.0 (compatible; MiraisShop/1.0)',
        'Accept':      'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!imgRes.ok) return res.status(imgRes.status).end();

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = await imgRes.arrayBuffer();
    res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    console.error('img-proxy error:', e.message);
    res.status(502).end('upstream error');
  }
}
