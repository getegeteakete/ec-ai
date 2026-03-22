// ============================================================
// Vercel Function: /api/orders
// GET  → 注文一覧取得（管理パネル用）
// PATCH → 追跡番号・ステータス更新
// ============================================================
import { setCorsHeaders, rateLimit, validateAdminToken, sanitizeString } from './_security.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // レート制限（管理API: 60リクエスト/分）
  if (!rateLimit(req, res, 60, 60000)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。しばらく待ってください。' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'サーバー設定エラー' }); // 詳細は隠す
  }

  // 管理者認証（タイミング攻撃対策済み）
  if (!validateAdminToken(req)) {
    // 認証失敗をログ（IP記録）
    const ip = req.headers['x-forwarded-for'] || 'unknown';
    console.warn(`[AUTH FAIL] IP:${ip} URL:${req.url} UA:${req.headers['user-agent']?.slice(0,100)}`);
    return res.status(401).json({ error: '認証エラー' });
  }

  // ── GET: 注文一覧取得 ──
  if (req.method === 'GET') {
    const status = sanitizeString(req.query.status, 20);
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500); // 最大500件

    let url = `${SUPABASE_URL}/rest/v1/orders?order=created_at.desc&limit=${limit}`;
    // SQLインジェクション対策：statusは許可リストで検証
    const allowedStatuses = ['pending', 'paid', 'shipped', 'failed', 'expired'];
    if (status && status !== 'all' && allowedStatuses.includes(status)) {
      url += `&status=eq.${status}`;
    }

    try {
      const supaRes = await fetch(url, {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (!supaRes.ok) throw new Error('DB error');
      const orders = await supaRes.json();
      return res.status(200).json({ orders });
    } catch (e) {
      console.error('orders GET error:', e.message);
      return res.status(500).json({ error: '注文取得に失敗しました' });
    }
  }

  // ── PATCH: 追跡番号・ステータス更新 ──
  if (req.method === 'PATCH') {
    const { order_no, tracking_no, status, receipt_sent } = req.body || {};
    if (!order_no) return res.status(400).json({ error: 'order_no 必須' });

    // 入力サニタイズ
    const safeOrderNo    = sanitizeString(order_no, 30);
    const safeTrackingNo = tracking_no ? sanitizeString(tracking_no, 50).replace(/[^0-9\-]/g, '') : undefined;

    const fields = {};
    if (safeTrackingNo !== undefined) fields.tracking_no = safeTrackingNo;
    if (status !== undefined) {
      const allowed = ['pending','paid','shipped','failed','expired'];
      if (allowed.includes(status)) fields.status = status;
    }
    if (receipt_sent !== undefined) fields.receipt_sent = Boolean(receipt_sent);

    if (safeTrackingNo) {
      const cleanNo = safeTrackingNo.replace(/-/g, '');
      fields.tracking_url = `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${cleanNo}`;
      fields.status = 'shipped';
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: '更新フィールドがありません' });
    }

    try {
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?order_no=eq.${encodeURIComponent(safeOrderNo)}`,
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
      return res.status(200).json({ order: updated[0] || null });
    } catch (e) {
      console.error('orders PATCH error:', e.message);
      return res.status(500).json({ error: '更新に失敗しました' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
