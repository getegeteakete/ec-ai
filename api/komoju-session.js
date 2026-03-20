// ============================================================
// Vercel Function: /api/komoju-session
// 対応決済: クレジットカード / コンビニ / PayPay / 銀行振込
//
// 【Vercel環境変数】KOMOJU_SECRET_KEY = sk_live_xxxxx
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.KOMOJU_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'KOMOJU_SECRET_KEY が未設定です' });

  const { amount, currency, orderNo, email, returnUrl, paymentType, items, customer } = req.body;
  if (!amount || !orderNo) return res.status(400).json({ error: '必須パラメータ不足' });

  // KOMOJUのpayment_types値マッピング
  const PAYMENT_MAP = {
    credit_card:   ['credit_card'],
    konbini:       ['konbini'],
    paypay:        ['paypay'],
    bank_transfer: ['bank_transfer'],
    all:           ['credit_card','konbini','paypay','bank_transfer'],
  };
  const paymentTypes = PAYMENT_MAP[paymentType] || PAYMENT_MAP['all'];

  try {
    const body = {
      amount,
      currency:           currency || 'JPY',
      external_order_num: orderNo,
      return_url:         returnUrl || 'https://ec-ai.vercel.app/?order=complete',
      default_locale:     'ja',
      payment_types:      paymentTypes,
      email:              email || undefined,
      metadata: { order_number: orderNo, shop_name: '米粉バウムクーヘン工房 未来図' },
    };

    if (items && items.length > 0) {
      body.line_items = items.map(i => ({
        description: i.description,
        quantity:    i.quantity,
        amount:      i.amount,
        currency:    'JPY',
      }));
    }

    if (customer) {
      body.customer = {
        given_name:  customer.first || '',
        family_name: customer.last  || '',
        email:       email || '',
        phone:       customer.tel || '',
      };
      if (customer.addr1) {
        body.shipping_address = {
          postal_code: (customer.zip || '').replace('-',''),
          region:       customer.pref  || '',
          locality:    '',
          street:       customer.addr1 + (customer.addr2 ? ' '+customer.addr2 : ''),
          country:     'JP',
        };
      }
    }

    const response = await fetch('https://komoju.com/api/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'Accept':               'application/json',
        'Authorization':        'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
        'X-KOMOJU-API-VERSION': '2024-07-15',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('KOMOJU error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'KOMOJU APIエラー' });
    }

    return res.status(200).json({ session_id: data.id, session_url: data.session_url });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
}
