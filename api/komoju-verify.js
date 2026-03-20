// ============================================================
// Vercel Function: /api/komoju-verify
// KOMOJUのセッションステータスを確認して決済完了を検証
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.KOMOJU_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: '非公開鍵未設定' });

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id が必要です' });

  try {
    const response = await fetch(`https://komoju.com/api/v1/sessions/${session_id}`, {
      headers: {
        'Authorization':        'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
        'X-KOMOJU-API-VERSION': '2024-07-15',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'セッション取得失敗', details: data });
    }

    return res.status(200).json({
      status:     data.status,        // 'pending' / 'completed' / 'expired'
      payment_id: data.payment?.id,
      amount:     data.amount,
      order_num:  data.external_order_num,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
