// ============================================================
// Vercel Function: /api/komoju-webhook
// KOMOJUからの決済完了Webhook受信
//
// 【KOMOJUダッシュボードのWebhook設定】
//   URL: https://ec-ai.vercel.app/api/komoju-webhook
//   シークレット: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// 【Vercel環境変数】
//   KOMOJU_SECRET_KEY    = [非公開鍵をVercel環境変数に設定]
//   KOMOJU_WEBHOOK_TOKEN = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// ============================================================

import crypto from 'crypto';

// Vercelのbodyパーサーを無効化（署名検証のため生のbodyが必要）
export const config = { api: { bodyParser: false } };

// raw bodyを読み込む
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookToken = process.env.KOMOJU_WEBHOOK_TOKEN;
  const rawBody = await getRawBody(req);

  // ── HMAC-SHA256署名検証 ──
  if (webhookToken) {
    const signature = req.headers['x-komoju-signature'] || '';
    const expected  = crypto
      .createHmac('sha256', webhookToken)
      .update(rawBody)
      .digest('hex');

    if (signature !== expected) {
      console.warn('Webhook署名が不正です');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('KOMOJU Webhook受信:', event.type, event.data?.external_order_num);

  // ── イベント種別ごとの処理 ──
  switch (event.type) {

    case 'payment.captured':
    case 'payment.authorized': {
      // 決済完了
      const orderNum    = event.data?.external_order_num || '';
      const paymentId   = event.data?.id || '';
      const amount      = event.data?.amount || 0;
      const paymentType = event.data?.payment_details?.type || '';
      console.log(`✅ 決済完了: ${orderNum} / ${paymentId} / ¥${amount} / ${paymentType}`);
      // TODO: データベース連携時はここで注文ステータスを更新
      break;
    }

    case 'payment.failed': {
      const orderNum = event.data?.external_order_num || '';
      console.log(`❌ 決済失敗: ${orderNum}`);
      break;
    }

    case 'payment.expired': {
      const orderNum = event.data?.external_order_num || '';
      console.log(`⏰ 決済期限切れ: ${orderNum}`);
      break;
    }

    default:
      console.log('未処理イベント:', event.type);
  }

  // KOMOJUには200を返す（リトライ防止）
  return res.status(200).json({ received: true });
}
