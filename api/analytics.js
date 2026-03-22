// ============================================================
// Vercel Function: /api/analytics
// GET  → アクセス集計（Supabase page_views テーブルがなければ
//         注文データから簡易集計してフォールバック）
// POST → ページビュー記録
// ============================================================
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN  = process.env.ADMIN_PASSWORD || 'mirais2024';

const ALLOWED = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  'http://localhost:3000',
];

const sbFetch = (path, opts = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey':       SB_KEY,
      'Authorization':`Bearer ${SB_KEY}`,
      ...(opts.headers || {}),
    },
  });

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: ページビュー記録（テーブルなければ無視）
  if (req.method === 'POST') {
    try {
      const { page, product_id, action, amount, session_id } = req.body || {};
      if (!page) return res.status(400).json({ error: 'page必須' });
      await sbFetch('page_views', {
        method: 'POST',
        body: JSON.stringify({
          page,
          product_id: product_id || null,
          action:     action || 'view',
          amount:     amount || 0,
          session_id: session_id || '',
        }),
      });
    } catch (_) { /* テーブルなくても無視 */ }
    return res.status(200).json({ ok: true });
  }

  // GET: 集計（管理者のみ）
  if (req.method === 'GET') {
    if (req.headers['x-admin-token'] !== ADMIN)
      return res.status(401).json({ error: '認証エラー' });

    const days  = parseInt(req.query.days || '30');
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // 日別トレンド雛形（過去7日）
    const daily = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      daily[d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })] = 0;
    }

    // ── page_views テーブルから取得を試みる ──
    let total_pv = 0, by_page = {}, top_products = [];
    try {
      const [pvRes, topRes] = await Promise.all([
        sbFetch(`page_views?created_at=gte.${since}&select=page,action,created_at`),
        sbFetch(`page_views?created_at=gte.${since}&action=eq.view&product_id=not.is.null&select=product_id`),
      ]);
      const views = await pvRes.json();
      const pviews = await topRes.json();

      if (Array.isArray(views) && views.length > 0) {
        total_pv = views.length;
        by_page  = views.reduce((acc, v) => {
          acc[v.page] = (acc[v.page] || 0) + 1; return acc;
        }, {});
        views.forEach(v => {
          const d = new Date(v.created_at).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
          if (daily[d] !== undefined) daily[d]++;
        });
        const byProd = pviews.reduce((acc, v) => {
          acc[v.product_id] = (acc[v.product_id] || 0) + 1; return acc;
        }, {});
        top_products = Object.entries(byProd)
          .sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([id, count]) => ({ product_id: parseInt(id), views: count }));
      }
    } catch (_) { /* page_views テーブルなければスキップ */ }

    // ── 注文データから売上・購入数を集計（必ず動く）──
    let total_sales = 0, purchase_count = 0;
    try {
      const ordRes = await sbFetch(
        `orders?created_at=gte.${since}&select=total,status,created_at,items`
      );
      const orders = await ordRes.json();
      if (Array.isArray(orders)) {
        const paid = orders.filter(o =>
          ['paid', 'shipped', 'preparing', 'completed'].includes(o.status)
        );
        purchase_count = paid.length;
        total_sales    = paid.reduce((s, o) => s + (o.total || 0), 0);

        // 注文日をトレンドに反映
        if (total_pv === 0) {
          paid.forEach(o => {
            const dt = new Date(o.created_at);
            const key = dt.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
            if (daily[key] !== undefined) daily[key]++;
          });
          total_pv = orders.length; // 訪問推定としてオーダー件数を使う
        }

        // 人気商品：注文データから集計
        if (top_products.length === 0) {
          const itemCount = {};
          paid.forEach(o => {
            (o.items || []).forEach(it => {
              const name = it.name || it.description || '';
              const clean = name.split('（')[0].trim();
              if (clean) itemCount[clean] = (itemCount[clean] || 0) + (it.quantity || it.qty || 1);
            });
          });
          top_products = Object.entries(itemCount)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([name, count]) => ({ product_name: name, views: count }));
        }
      }
    } catch (_) { /* ordersテーブルエラーもスキップ */ }

    const cvr = total_pv > 0 ? ((purchase_count / total_pv) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      period_days:    days,
      total_pv,
      total_sales,
      purchase_count,
      cvr:            parseFloat(cvr),
      by_page,
      top_products,
      daily_trend:    Object.entries(daily).map(([date, pv]) => ({ date, pv })),
      note: total_pv === 0 ? 'アクセス記録なし（page_viewsテーブル未設定）' : null,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
