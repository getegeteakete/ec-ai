// ============================================================
// Vercel Function: /api/btob-leads
// GET   → 承認待ちリードの一覧取得
// PATCH → ステータス更新（approved / rejected / sent）
// ============================================================

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN    = process.env.ADMIN_PASSWORD || 'mirais2024';
const RESEND   = process.env.RESEND_API_KEY;
const FROM     = process.env.RESEND_FROM_EMAIL || 'shop@fukuoka-mirais.com';

const ALLOWED  = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  'http://localhost:3000',
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-token'] !== ADMIN) {
    return res.status(401).json({ error: '認証エラー' });
  }
  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ error: 'Supabase未設定' });
  }

  // ── GET: リード一覧取得 ──
  if (req.method === 'GET') {
    const { status, date, limit = 50 } = req.query;
    let url = `${SB_URL}/rest/v1/btob_leads?order=created_at.desc&limit=${limit}`;
    if (status && status !== 'all') url += `&status=eq.${status}`;
    if (date) url += `&run_date=eq.${date}`;

    const r = await fetch(url, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (!r.ok) return res.status(500).json({ error: 'DB取得失敗' });
    const leads = await r.json();
    return res.status(200).json({ leads, total: leads.length });
  }

  // ── PATCH: ステータス更新 ──
  if (req.method === 'PATCH') {
    const { id, status, note, send_email, to_email } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: 'id と status 必須' });

    const allowed_statuses = ['pending', 'approved', 'sent', 'rejected'];
    if (!allowed_statuses.includes(status)) return res.status(400).json({ error: '不正なstatus' });

    const fields = { status };
    if (note !== undefined) fields.note = note;
    if (status === 'sent') fields.sent_at = new Date().toISOString();

    // Supabase更新
    const r = await fetch(
      `${SB_URL}/rest/v1/btob_leads?id=eq.${parseInt(id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(fields),
      }
    );
    if (!r.ok) return res.status(500).json({ error: 'DB更新失敗' });
    const updated = await r.json();
    const lead = updated[0];

    // 「送信する」が選択された場合、Resendで実際に送信
    if (send_email && to_email && status === 'sent' && lead && RESEND) {
      try {
        // メール本文をHTMLに変換（改行→<br>）
        const bodyHtml = (lead.email_body || '')
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/\n/g, '<br>');

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    `米粉バウムクーヘン工房 未来図 <${FROM}>`,
            to:      [to_email],
            subject: lead.email_subject || '未来図からのご提案',
            html: `<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:14px;line-height:2;color:#333;max-width:600px;margin:0 auto;padding:20px">
              ${bodyHtml}
              <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
              <p style="font-size:12px;color:#888">
                ──────────────────<br>
                米粉バウムクーヘン工房 未来図<br>
                〒814-0123 福岡県福岡市城南区長尾1-15-21-103<br>
                TEL: 092-834-9856　Mail: shop@fukuoka-mirais.com<br>
                HP: https://ec-ai-three.vercel.app
              </p>
            </div>`,
          }),
        });
      } catch (e) {
        console.error('Send email error:', e.message);
        return res.status(200).json({ lead, warning: 'メール送信に失敗しました: ' + e.message });
      }
    }

    return res.status(200).json({ lead });
  }

  // ── DELETE: リード削除 ──
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id 必須' });
    await fetch(`${SB_URL}/rest/v1/btob_leads?id=eq.${parseInt(id)}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
