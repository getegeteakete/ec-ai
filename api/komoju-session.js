// ============================================================
// Vercel Function: /api/komoju-session
// KOMOJUの決済セッションを作成してsession_urlを返す
//
// 【Vercel環境変数に設定が必要】
//   KOMOJU_SECRET_KEY = sk_live_xxxxxxxxxxxxxxxx  （非公開鍵）
//
// 設定場所: Vercel Dashboard → プロジェクト → Settings → Environment Variables
// ============================================================

export default async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.KOMOJU_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({
      error: '非公開鍵が設定されていません。Vercelの環境変数 KOMOJU_SECRET_KEY を設定してください。'
    });
  }

  const { amount, currency, orderNo, email, returnUrl, items, shipping } = req.body;

  // 入力検証
  if (!amount || !currency || !orderNo) {
    return res.status(400).json({ error: '必須パラメータが不足しています' });
  }

  try {
    // KOMOJU セッション作成API
    const response = await fetch('https://komoju.com/api/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'Accept':              'application/json',
        'Authorization':       'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
        'X-KOMOJU-API-VERSION': '2024-07-15',
      },
      body: JSON.stringify({
        amount:               amount,
        currency:             currency,
        external_order_num:   orderNo,
        email:                email || undefined,
        return_url:           returnUrl || 'https://ec-ai.vercel.app/?order=complete',
        default_locale:       'ja',
        payment_types:        ['credit_card'],  // クレカのみ（追加したい場合: 'konbini','paypay'等）
        metadata: {
          order_number: orderNo,
          shop_name:    '米粉バウムクーヘン工房 未来図',
        },
        // 商品明細（任意）
        ...(items && items.length > 0 ? {
          line_items: items.map(item => ({
            description: item.description,
            quantity:    item.quantity,
            amount:      item.amount,
            currency:    'JPY',
          }))
        } : {}),
        // お届け先（不正検出率向上のため推奨）
        ...(shipping ? {
          customer: {
            name:  shipping.name,
            phone: shipping.phone,
            email: email || undefined,
          }
        } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('KOMOJU API error:', data);
      return res.status(response.status).json({
        error:   data.error?.message || 'KOMOJU APIエラー',
        details: data,
      });
    }

    // フロントエンドに session_url と session_id を返す
    return res.status(200).json({
      session_id:  data.id,
      session_url: data.session_url,
      status:      data.status,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'サーバーエラーが発生しました', message: err.message });
  }
}
