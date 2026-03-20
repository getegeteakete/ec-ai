// ============================================================
// Vercel Function: /api/orders
// GET  → 注文一覧取得（管理パネル用）
// PATCH → 追跡番号・ステータス更新
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase環境変数未設定' });
  }

  // 簡易管理者認証（管理パネルのパスワードをヘッダーで送信）
  const adminToken = req.headers['x-admin-token'];
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'mirais2024';
  if (adminToken !== ADMIN_PASS) {
    return res.status(401).json({ error: '認証エラー' });
  }

  // ── GET: 注文一覧取得 ──
  if (req.method === 'GET') {
    const { status, limit = 100 } = req.query;

    let url = `${SUPABASE_URL}/rest/v1/orders?order=created_at.desc&limit=${limit}`;
    if (status && status !== 'all') {
      url += `&status=eq.${status}`;
    }

    const supaRes = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!supaRes.ok) {
      return res.status(500).json({ error: 'Supabase取得失敗' });
    }
    const orders = await supaRes.json();
    return res.status(200).json({ orders });
  }

  // ── PATCH: 追跡番号・ステータス更新 ──
  if (req.method === 'PATCH') {
    const { order_no, tracking_no, status, receipt_sent } = req.body;
    if (!order_no) return res.status(400).json({ error: 'order_no 必須' });

    const fields = {};
    if (tracking_no  !== undefined) fields.tracking_no   = tracking_no;
    if (status       !== undefined) fields.status        = status;
    if (receipt_sent !== undefined) fields.receipt_sent  = receipt_sent;

    // 追跡番号が設定されたらURLも自動生成（ヤマト運輸）
    if (tracking_no) {
      const cleanNo = tracking_no.replace(/-/g, '');
      fields.tracking_url = `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${cleanNo}`;
      fields.status = 'shipped';
    }

    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?order_no=eq.${encodeURIComponent(order_no)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify(fields),
      }
    );

    const updated = await supaRes.json();
    return res.status(200).json({ order: updated[0] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
