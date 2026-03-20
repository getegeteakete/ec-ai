// ============================================================
// Vercel Function: /api/komoju-session
// KOMOJU決済セッション作成 + Supabaseに注文保存
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key

async function saveOrderToSupabase(orderData) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(orderData),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase保存失敗: ${err}`);
  }
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.KOMOJU_SECRET_KEY;
  if (!secretKey)    return res.status(500).json({ error: 'KOMOJU_SECRET_KEY 未設定' });
  if (!SUPABASE_URL) return res.status(500).json({ error: 'SUPABASE_URL 未設定' });
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 未設定' });

  const { amount, currency, orderNo, orderDate, email, returnUrl,
          paymentType, items, customer } = req.body;
  if (!amount || !orderNo) return res.status(400).json({ error: '必須パラメータ不足' });

  const PAYMENT_MAP = {
    credit_card:   ['credit_card'],
    konbini:       ['konbini'],
    paypay:        ['paypay'],
    bank_transfer: ['bank_transfer'],
    all:           ['credit_card', 'konbini', 'paypay', 'bank_transfer'],
  };
  const paymentTypes = PAYMENT_MAP[paymentType] || PAYMENT_MAP['all'];

  const sub   = items ? items.reduce((s, i) => s + i.amount * i.quantity, 0) : 0;
  const ship  = sub >= 5000 ? 0 : 660;
  const total = amount; // フロントで計算済み

  try {
    // ① Supabaseに注文を保存（ステータス: pending）
    await saveOrderToSupabase({
      order_no:       orderNo,
      order_date:     orderDate || new Date().toLocaleString('ja-JP'),
      status:         'pending',
      payment_method: paymentType || 'credit_card',
      customer:       customer || {},
      items:          items    || [],
      sub,
      ship,
      discount:       0,
      total,
      receipt_sent:   false,
    });

    // ② KOMOJUセッション作成
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
          postal_code: (customer.zip || '').replace('-', ''),
          region:       customer.pref || '',
          locality:    '',
          street:       customer.addr1 + (customer.addr2 ? ' ' + customer.addr2 : ''),
          country:     'JP',
        };
      }
    }

    const komojuRes = await fetch('https://komoju.com/api/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'Accept':               'application/json',
        'Authorization':        'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
        'X-KOMOJU-API-VERSION': '2024-07-15',
      },
      body: JSON.stringify(body),
    });

    const data = await komojuRes.json();
    if (!komojuRes.ok) {
      console.error('KOMOJU error:', data);
      return res.status(komojuRes.status).json({ error: data.error?.message || 'KOMOJU APIエラー' });
    }

    // ③ セッションIDをSupabaseに更新
    await fetch(`${SUPABASE_URL}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ session_id: data.id }),
    });

    return res.status(200).json({
      session_id:  data.id,
      session_url: data.session_url,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
}
