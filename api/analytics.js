// ============================================================
// Vercel Function: /api/analytics
// POST → ページビュー・行動ログ記録
// GET  → 集計データ取得（管理者のみ）
// ============================================================
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN  = process.env.ADMIN_PASSWORD || 'mirais2024';

export default async function handler(req, res) {
  const _origin = req.headers.origin || '';
  const _allowed = ['https://ec-ai-three.vercel.app','https://miraizu.vercel.app','http://localhost:3000'];
  res.setHeader('Access-Control-Allow-Origin', _allowed.includes(_origin) ? _origin : _allowed[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: ページビュー記録（認証不要）
  if (req.method === 'POST') {
    const { page, product_id, action, amount, session_id } = req.body;
    if (!page) return res.status(400).json({ error: 'page必須' });

    await fetch(`${SB_URL}/rest/v1/page_views`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       SB_KEY,
        'Authorization':`Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({ page, product_id: product_id || null, action: action||'view', amount: amount||0, session_id: session_id||'' }),
    });
    return res.status(200).json({ ok: true });
  }

  // GET: 集計（管理者のみ）
  if (req.method === 'GET') {
    if (req.headers['x-admin-token'] !== ADMIN)
      return res.status(401).json({ error: '認証エラー' });

    const days = parseInt(req.query.days || '30');
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // 並列取得
    const [pvRes, actionRes, topRes] = await Promise.all([
      // 日別ページビュー
      fetch(`${SB_URL}/rest/v1/page_views?created_at=gte.${since}&select=page,action,created_at`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
      }),
      // アクション別集計
      fetch(`${SB_URL}/rest/v1/page_views?created_at=gte.${since}&action=eq.purchase&select=amount`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
      }),
      // 人気商品
      fetch(`${SB_URL}/rest/v1/page_views?created_at=gte.${since}&action=eq.view&product_id=not.is.null&select=product_id`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
      }),
    ]);

    const views   = await pvRes.json();
    const sales   = await actionRes.json();
    const product_views = await topRes.json();

    // 集計処理
    const total_pv       = views.length;
    const total_sales    = sales.reduce((s, r) => s + (r.amount||0), 0);
    const purchase_count = sales.length;
    const cvr = total_pv > 0 ? ((purchase_count / total_pv) * 100).toFixed(1) : '0.0';

    // ページ別集計
    const by_page = views.reduce((acc, v) => {
      acc[v.page] = (acc[v.page] || 0) + 1; return acc;
    }, {});

    // 商品別ビュー集計
    const by_product = product_views.reduce((acc, v) => {
      acc[v.product_id] = (acc[v.product_id] || 0) + 1; return acc;
    }, {});
    const top_products = Object.entries(by_product)
      .sort((a,b) => b[1]-a[1]).slice(0,5)
      .map(([id, count]) => ({ product_id: parseInt(id), views: count }));

    // 日別トレンド（過去7日）
    const daily = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      daily[d.toLocaleDateString('ja-JP', {month:'2-digit',day:'2-digit'})] = 0;
    }
    views.forEach(v => {
      const d = new Date(v.created_at).toLocaleDateString('ja-JP', {month:'2-digit',day:'2-digit'});
      if (daily[d] !== undefined) daily[d]++;
    });

    return res.status(200).json({
      period_days: days,
      total_pv,
      total_sales,
      purchase_count,
      cvr: parseFloat(cvr),
      by_page,
      top_products,
      daily_trend: Object.entries(daily).map(([date, pv]) => ({ date, pv })),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
