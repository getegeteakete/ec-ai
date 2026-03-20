// ============================================================
// Vercel Function: /api/komoju-webhook
// KOMOJU決済完了Webhook → Supabase注文ステータス更新
// ============================================================

import crypto from 'crypto';
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function updateOrder(orderNo, fields) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${url}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify(fields),
    }
  );
  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookToken = process.env.KOMOJU_WEBHOOK_TOKEN;
  const rawBody = await getRawBody(req);

  // 署名検証
  if (webhookToken) {
    const sig      = req.headers['x-komoju-signature'] || '';
    const expected = crypto.createHmac('sha256', webhookToken).update(rawBody).digest('hex');
    if (sig !== expected) {
      console.warn('Webhook署名不正');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try { event = JSON.parse(rawBody.toString()); }
  catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }

  const orderNo   = event.data?.external_order_num || '';
  const paymentId = event.data?.id || '';

  console.log(`Webhook: ${event.type} / ${orderNo}`);

  switch (event.type) {
    case 'payment.captured':
    case 'payment.authorized':
      // 決済完了 → ステータスをpaidに更新
      if (orderNo) {
        await updateOrder(orderNo, {
          status:     'paid',
          payment_id: paymentId,
        });
        console.log(`✅ 決済完了: ${orderNo}`);
      }
      break;

    case 'payment.failed':
      if (orderNo) {
        await updateOrder(orderNo, { status: 'failed' });
        console.log(`❌ 決済失敗: ${orderNo}`);
      }
      break;

    case 'payment.expired':
      if (orderNo) {
        await updateOrder(orderNo, { status: 'expired' });
        console.log(`⏰ 期限切れ: ${orderNo}`);
      }
      break;
  }

  return res.status(200).json({ received: true });
}
