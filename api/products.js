// ============================================================
// Vercel Function: /api/products
// GET    → 商品一覧（フロントエンド用・認証不要）
// POST   → 新規追加（管理者のみ）
// PUT    → 更新（管理者のみ）
// DELETE → 削除（管理者のみ）
// ============================================================
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN  = process.env.ADMIN_PASSWORD || 'mirais2024';

const sb = (path, opts={}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { 'Content-Type':'application/json', 'apikey':SB_KEY,
    'Authorization':`Bearer ${SB_KEY}`, 'Prefer':'return=representation', ...(opts.headers||{}) },
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 全商品（認証不要）
  if (req.method === 'GET') {
    const { active_only = 'true', category } = req.query;
    let q = 'products?order=sort_order.asc,id.asc';
    if (active_only === 'true') q += '&active=eq.true';
    if (category) q += `&category=eq.${category}`;
    const r = await sb(q);
    const data = await r.json();
    return res.status(200).json({ products: data });
  }

  // 管理者認証チェック
  if (req.headers['x-admin-token'] !== ADMIN)
    return res.status(401).json({ error: '認証エラー' });

  // POST: 新規商品追加
  if (req.method === 'POST') {
    const r = await sb('products', { method:'POST', body: JSON.stringify(req.body) });
    const data = await r.json();
    return res.status(r.ok ? 201 : 400).json(data[0] || data);
  }

  // PUT: 商品更新
  if (req.method === 'PUT') {
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: 'id必須' });
    const r = await sb(`products?id=eq.${id}`, { method:'PATCH', body: JSON.stringify(fields) });
    const data = await r.json();
    return res.status(200).json(data[0] || data);
  }

  // DELETE: 商品削除（実際は非公開に）
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id必須' });
    const r = await sb(`products?id=eq.${id}`, { method:'PATCH', body: JSON.stringify({ active: false }) });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
