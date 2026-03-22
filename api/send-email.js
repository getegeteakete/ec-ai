// ============================================================
// Vercel Function: /api/send-email
// Resend API でメールを送信（3種類対応）
//
// 【Vercel環境変数 - 設定済み確認済み】
//   RESEND_API_KEY      = re_8GqegZc2_KAd2rFqKzdtC59EvVbpwJcf5
//   RESEND_FROM_EMAIL   = info@fukuoka-mirais.com
//   RESEND_TO_EMAIL     = shop@fukuoka-mirais.com
//   RESEND_USE_TEST_SENDER = true  ← テスト中はこのまま
//
// 【type の種類】
//   'receipt'      : 注文確認メール（顧客宛）
//   'tracking'     : 発送通知メール（顧客宛）
//   'shop_notify'  : 新規注文通知（店舗宛）
// ============================================================

export default async function handler(req, res) {
  // セキュリティヘッダー
  const origin = req.headers.origin || '';
  const allowed = ['https://ec-ai-three.vercel.app','https://miraizu.vercel.app','http://localhost:3000'];
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY    = process.env.RESEND_API_KEY;
  const FROM_EMAIL        = process.env.RESEND_FROM_EMAIL || 'info@fukuoka-mirais.com';
  const SHOP_EMAIL        = process.env.RESEND_TO_EMAIL   || 'shop@fukuoka-mirais.com';
  const USE_TEST_SENDER   = process.env.RESEND_USE_TEST_SENDER === 'true';

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY が設定されていません' });
  }

  const { type, order } = req.body;
  if (!type || !order) {
    return res.status(400).json({ error: 'type と order が必要です' });
  }

  // ── メール内容を組み立て ──
  let to, subject, html;

  // 商品明細HTML（カート形式 / Supabase形式 両対応）
  const itemsHtml = (order.items || []).map(it => {
    // カート形式: { name, size, qty, price }
    // Supabase形式: { description, quantity, amount }
    const itemQty   = it.qty  || it.quantity || 1;
    const itemPrice = it.price || it.amount || 0;
    const itemTotal = itemPrice * itemQty;

    // 商品名：name優先。なければdescriptionを使用
    // 最初の（ 以降を全てカット → グラム数・サイズ補足を除去してシンプルに
    const rawName = it.name || it.description || '';
    const displayName = rawName.split('（')[0].trim();

    // オプション表示（紙袋・ギフト包装）
    const opts = [
      it.paperbag  === 'あり' ? '🛍️ 紙袋あり' : '',
      it.wrapping  === 'あり' ? '🎁 ギフト包装あり' : '',
    ].filter(Boolean).join('　');

    return `
    <tr>
      <td style="padding:11px 14px;border-bottom:1px solid #f0e8d8;color:#342010;font-size:13px;line-height:1.6">
        ${displayName}
        ${opts ? `<br><span style="font-size:11px;color:#7A9E6A">${opts}</span>` : ''}
      </td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0e8d8;text-align:center;color:#6B4A28;font-size:13px;white-space:nowrap">${itemQty}個</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0e8d8;text-align:right;font-weight:600;color:#A8660E;font-size:13px;white-space:nowrap">¥${itemTotal.toLocaleString('ja-JP')}</td>
    </tr>`;
  }).join('');

  const name   = `${order.customer?.last || ''}${order.customer?.first || ''}`;
  const addr   = `〒${order.customer?.zip || ''} ${order.customer?.pref || ''}${order.customer?.addr1 || ''}${order.customer?.addr2 ? ' '+order.customer.addr2 : ''}`;
  const sub    = Number(order.sub   || 0);
  const ship   = Number(order.ship  || 0);
  const disc   = Number(order.discount || 0);
  const total  = Number(order.total || 0);

  // 発送予定日
  const now       = new Date();
  const shipFrom  = new Date(now); shipFrom.setDate(shipFrom.getDate() + 7);
  const shipTo    = new Date(now); shipTo.setDate(shipTo.getDate() + 10);
  const fmt = d => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;

  // フッターHTML（共通）
  const footerHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#5C3317;border-radius:0 0 14px 14px;margin-top:0">
      <tr><td style="padding:24px 36px;text-align:center">
        <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#EFB96A;letter-spacing:.08em">米粉バウムクーヘン工房 未来図</p>
        <p style="margin:0 0 10px;font-size:10px;color:rgba(255,255,255,.5)">KOMEFUN BAUMKUCHEN KOBO MIRAIS</p>
        <p style="margin:0 0 3px;font-size:12px;color:rgba(255,255,255,.8)">📍 〒814-0123 福岡県福岡市城南区長尾1-15-21-103 フローレス長尾</p>
        <p style="margin:0 0 3px;font-size:12px;color:rgba(255,255,255,.8)">📞 092-834-9856　⏰ 11:00〜17:00（水・日定休）</p>
        <p style="margin:0 0 14px;font-size:12px;color:rgba(255,255,255,.8)">📧 shop@fukuoka-mirais.com　📸 @fukuoka_mirais</p>
        <p style="margin:0;font-size:10px;color:rgba(255,255,255,.35)">© ${now.getFullYear()} 米粉バウムクーヘン工房 未来図. All rights reserved.</p>
      </td></tr>
    </table>`;

  // ══════════════════════════════════
  // ① 注文確認メール（顧客宛）
  // ══════════════════════════════════
  if (type === 'receipt') {
    to      = order.customer?.email;
    subject = `【未来図】ご注文ありがとうございます（${order.id}）`;
    html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ede0;font-family:'Hiragino Sans','Noto Sans JP',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5ede0;padding:28px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- ヘッダー -->
  <tr><td style="background:linear-gradient(135deg,#5C3317,#8B5A2B);border-radius:14px 14px 0 0;padding:32px 36px;text-align:center">
    <p style="margin:0 0 4px;color:rgba(255,255,255,.6);font-size:10px;letter-spacing:.2em">KOMEFUN BAUMKUCHEN KOBO</p>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">米粉バウムクーヘン工房</h1>
    <h2 style="margin:2px 0 14px;color:#EFB96A;font-size:28px;font-weight:700;letter-spacing:.08em">未来図</h2>
    <span style="display:inline-block;background:rgba(255,255,255,.18);color:#fff;font-size:13px;padding:7px 22px;border-radius:50px;border:1px solid rgba(255,255,255,.35)">✅ ご注文確認</span>
  </td></tr>

  <!-- ボディ -->
  <tr><td style="background:#fff;padding:36px">

    <p style="margin:0 0 22px;font-size:15px;color:#342010;line-height:1.9">
      <strong>${name} 様</strong><br><br>
      この度は米粉バウムクーヘン工房 未来図にご注文いただき、誠にありがとうございます。<br>
      以下の内容でご注文を承りましたのでご確認ください。
    </p>

    <!-- 注文番号 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border:2px dashed #D4913A;border-radius:10px;margin-bottom:26px">
      <tr><td style="padding:16px 22px;text-align:center">
        <p style="margin:0 0 3px;font-size:11px;color:#9C7A58;letter-spacing:.1em">注文番号</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#5C3317;letter-spacing:.05em">${order.id}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#9C7A58">注文日時：${order.date}</p>
      </td></tr>
    </table>

    <!-- 商品明細 -->
    <h3 style="margin:0 0 12px;font-size:14px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:9px">🛒 ご注文商品</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px">
      <tr style="background:#FDF7EE">
        <th style="padding:9px 14px;text-align:left;color:#6B4A28;font-size:12px;font-weight:600">商品名</th>
        <th style="padding:9px 14px;text-align:center;color:#6B4A28;font-size:12px;font-weight:600;width:55px">数量</th>
        <th style="padding:9px 14px;text-align:right;color:#6B4A28;font-size:12px;font-weight:600;width:95px">金額</th>
      </tr>
      ${itemsHtml}
    </table>

    <!-- 金額 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border-radius:10px;margin-bottom:26px">
      <tr><td style="padding:9px 18px;font-size:13px;color:#6B4A28">小計</td><td style="padding:9px 18px;text-align:right;font-size:13px;color:#342010">¥${sub.toLocaleString('ja-JP')}</td></tr>
      <tr><td style="padding:9px 18px;font-size:13px;color:#6B4A28">送料</td><td style="padding:9px 18px;text-align:right;font-size:13px;color:#342010">${ship === 0 ? '無料（5,000円以上送料無料）' : '¥' + ship.toLocaleString('ja-JP')}</td></tr>
      ${disc > 0 ? `<tr><td style="padding:9px 18px;font-size:13px;color:#7A9E6A">割引</td><td style="padding:9px 18px;text-align:right;font-size:13px;color:#7A9E6A">-¥${disc.toLocaleString('ja-JP')}</td></tr>` : ''}
      <tr style="border-top:2px solid #EAD5B8"><td style="padding:13px 18px;font-size:15px;font-weight:700;color:#5C3317">合計（税込）</td><td style="padding:13px 18px;text-align:right;font-size:19px;font-weight:700;color:#A8660E">¥${total.toLocaleString('ja-JP')}</td></tr>
    </table>

    <!-- お届け先 -->
    <h3 style="margin:0 0 12px;font-size:14px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:9px">📦 お届け先</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f5ef;border-radius:8px;margin-bottom:22px">
      <tr><td style="padding:16px 18px;font-size:13px;color:#342010;line-height:2.2">
        <strong>${name} 様</strong><br>
        ${addr}<br>
        TEL：${order.customer?.tel || ''}
        ${order.customer?.note ? '<br>備考：' + order.customer.note : ''}
      </td></tr>
    </table>

    <!-- 配達希望日 -->
    ${(order.customer?.delivery_date || order.customer?.delivery_time) ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border:1px solid #EAD5B8;border-radius:8px;margin-bottom:14px">
      <tr><td style="padding:12px 18px;font-size:13px;color:#342010">
        <strong>📅 配達希望：</strong>
        ${order.customer.delivery_date || '日付指定なし'} ${order.customer.delivery_time || '時間指定なし'}
      </td></tr>
    </table>` : ''}

    <!-- 紙袋・包装オプション -->
    ${(order.items||[]).some(i=>i.paperbag==='あり'||i.wrapping==='あり') ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#EBF4E4;border-radius:8px;margin-bottom:14px">
      <tr><td style="padding:12px 18px;font-size:13px;color:#342010">
        <strong>🎁 ご指定オプション：</strong><br>
        ${(order.items||[]).filter(i=>i.paperbag==='あり'||i.wrapping==='あり').map(i=>
          `${i.name}: ${[i.paperbag==='あり'?'紙袋あり':'',i.wrapping==='あり'?'ギフト包装あり':''].filter(Boolean).join('・')}`
        ).join('<br>')}
      </td></tr>
    </table>` : ''}

    <!-- 発送予定 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#EBF4E4;border-left:4px solid #7A9E6A;border-radius:0 8px 8px 0;margin-bottom:22px">
      <tr><td style="padding:14px 18px">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#5C3317">🚚 発送予定</p>
        <p style="margin:0;font-size:13px;color:#342010">ご注文から <strong>1週間〜10日以内</strong>（${fmt(shipFrom)}〜${fmt(shipTo)}頃）に発送いたします。<br>発送時に追跡番号をご案内するメールをお送りします。</p>
      </td></tr>
    </table>

    <!-- 注意事項 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border-radius:8px;margin-bottom:8px">
      <tr><td style="padding:16px 18px">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#5C3317">⚠️ ご注意事項</p>
        <ul style="margin:0;padding-left:16px;font-size:12px;color:#6B4A28;line-height:2.2">
          <li>食品のため、お客様都合による返品・交換はお受けできません</li>
          <li>商品に問題がある場合は到着後<strong>7日以内</strong>にご連絡ください</li>
          <li>ご不在が続くと保管期限切れによる返送が発生する場合があります</li>
        </ul>
      </td></tr>
    </table>

  </td></tr>
  ${footerHtml}
</table>
</td></tr>
</table>
</body></html>`;
  }

  // ══════════════════════════════════
  // ② 発送通知メール（顧客宛）
  // ══════════════════════════════════
  else if (type === 'tracking') {
    to      = order.customer?.email;
    subject = `【未来図】ご注文商品を発送しました（${order.id}）`;
    const d1 = new Date(); d1.setDate(d1.getDate() + 2);
    const d2 = new Date(); d2.setDate(d2.getDate() + 5);
    html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ede0;font-family:'Hiragino Sans','Noto Sans JP',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5ede0;padding:28px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- ヘッダー -->
  <tr><td style="background:linear-gradient(135deg,#3a6b3a,#7A9E6A);border-radius:14px 14px 0 0;padding:32px 36px;text-align:center">
    <h1 style="margin:0 0 14px;color:#fff;font-size:20px;font-weight:700">米粉バウムクーヘン工房 未来図</h1>
    <div style="display:inline-block;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.5);border-radius:50px;padding:10px 26px">
      <p style="margin:0;font-size:18px;font-weight:700;color:#fff">📦 商品を発送しました！</p>
    </div>
  </td></tr>

  <!-- ボディ -->
  <tr><td style="background:#fff;padding:36px">

    <p style="margin:0 0 26px;font-size:15px;color:#342010;line-height:1.9">
      <strong>${name} 様</strong><br><br>
      いつもご利用いただきありがとうございます。<br>
      ご注文の商品を本日発送いたしましたのでご連絡申し上げます。
    </p>

    <!-- 追跡番号 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#EBF4E4,#d4edda);border-radius:12px;margin-bottom:26px">
      <tr><td style="padding:26px;text-align:center">
        <p style="margin:0 0 5px;font-size:11px;color:#5C8040;letter-spacing:.1em;font-weight:600">TRACKING NUMBER</p>
        <p style="margin:0 0 18px;font-size:26px;font-weight:700;color:#3a6b3a;letter-spacing:.1em;font-family:monospace">${order.trackingNo || ''}</p>
        <a href="${order.trackingUrl || '#'}" style="display:inline-block;background:#7A9E6A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:50px;font-size:14px;font-weight:700">🔍 荷物の追跡はこちら</a>
        <p style="margin:10px 0 0;font-size:11px;color:#5C8040">ヤマト運輸（クロネコヤマト）</p>
      </td></tr>
    </table>

    <!-- お届け予定 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border-radius:10px;margin-bottom:24px">
      <tr><td style="padding:18px 22px">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#5C3317">🗓️ お届け予定</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#A8660E">${d1.getMonth()+1}月${d1.getDate()}日〜${d2.getMonth()+1}月${d2.getDate()}日頃</p>
        <p style="margin:5px 0 0;font-size:11px;color:#9C7A58">※ 配送状況により前後する場合があります</p>
      </td></tr>
    </table>

    <!-- 注文サマリー -->
    <h3 style="margin:0 0 12px;font-size:14px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:9px">📋 ご注文情報</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:22px">
      <tr><td style="padding:8px 0;color:#6B4A28;border-bottom:1px solid #f0e8d8">注文番号</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#342010;border-bottom:1px solid #f0e8d8">${order.id}</td></tr>
      <tr><td style="padding:8px 0;color:#6B4A28;border-bottom:1px solid #f0e8d8">注文日時</td><td style="padding:8px 0;text-align:right;color:#342010;border-bottom:1px solid #f0e8d8">${order.date}</td></tr>
      <tr><td style="padding:8px 0;color:#6B4A28">ご請求金額</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#A8660E;font-size:15px">¥${total.toLocaleString('ja-JP')}</td></tr>
    </table>

    <!-- お届け先 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f5ef;border-radius:8px;margin-bottom:22px">
      <tr><td style="padding:14px 18px;font-size:13px;color:#342010;line-height:2">
        <strong>${name} 様</strong><br>${addr}<br>TEL：${order.customer?.tel || ''}
      </td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;border-left:4px solid #D4913A;border-radius:0 8px 8px 0">
      <tr><td style="padding:14px 18px">
        <p style="margin:0 0 7px;font-size:13px;font-weight:700;color:#5C3317">🍰 商品到着後のお願い</p>
        <ul style="margin:0;padding-left:16px;font-size:12px;color:#6B4A28;line-height:2.2">
          <li>到着後、必ず商品の状態をご確認ください</li>
          <li>問題がある場合は到着後<strong>7日以内</strong>にご連絡ください</li>
        </ul>
      </td></tr>
    </table>

  </td></tr>
  ${footerHtml}
</table>
</td></tr>
</table>
</body></html>`;
  }

  // ══════════════════════════════════
  // ③ 新規注文通知（店舗宛）
  // ══════════════════════════════════
  else if (type === 'shop_notify') {
    to      = SHOP_EMAIL;
    subject = `🔔【未来図】新規注文：${order.id}（¥${total.toLocaleString('ja-JP')}）`;
    html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e8e0d8;font-family:'Hiragino Sans','Noto Sans JP',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d8;padding:28px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:linear-gradient(135deg,#A8660E,#D4913A);border-radius:14px 14px 0 0;padding:24px 36px;text-align:center">
    <p style="margin:0 0 6px;font-size:26px">🔔</p>
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">新規注文が入りました！</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:12px">このメールは店舗スタッフ向けの自動通知です</p>
  </td></tr>

  <tr><td style="background:#fff;padding:32px">

    <!-- 注文番号 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border:2px solid #D4913A;border-radius:10px;margin-bottom:22px">
      <tr><td style="padding:14px 22px;text-align:center">
        <p style="margin:0 0 2px;font-size:10px;color:#9C7A58;letter-spacing:.1em">注文番号</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#5C3317">${order.id}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#9C7A58">${order.date}</p>
      </td></tr>
    </table>

    <!-- 顧客情報 -->
    <h3 style="margin:0 0 10px;font-size:13px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:8px">👤 注文者情報</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:20px;background:#f9f9f9;border-radius:8px">
      <tr><td style="padding:9px 14px;color:#6B4A28;font-weight:600;border-bottom:1px solid #eee;width:110px">お名前</td><td style="padding:9px 14px;color:#342010;border-bottom:1px solid #eee;font-weight:700">${name} 様</td></tr>
      <tr><td style="padding:9px 14px;color:#6B4A28;font-weight:600;border-bottom:1px solid #eee">メール</td><td style="padding:9px 14px;color:#342010;border-bottom:1px solid #eee">${order.customer?.email || ''}</td></tr>
      <tr><td style="padding:9px 14px;color:#6B4A28;font-weight:600;border-bottom:1px solid #eee">電話</td><td style="padding:9px 14px;color:#342010;border-bottom:1px solid #eee">${order.customer?.tel || ''}</td></tr>
      <tr><td style="padding:9px 14px;color:#6B4A28;font-weight:600;border-bottom:1px solid #eee">お届け先</td><td style="padding:9px 14px;color:#342010;border-bottom:1px solid #eee">${addr}</td></tr>
      <tr><td style="padding:9px 14px;color:#6B4A28;font-weight:600">備考</td><td style="padding:9px 14px;color:#342010">${order.customer?.note || 'なし'}</td></tr>
    </table>

    <!-- 注文商品 -->
    <h3 style="margin:0 0 10px;font-size:13px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:8px">🛒 注文商品</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr style="background:#FDF7EE">
        <th style="padding:8px 14px;text-align:left;color:#6B4A28;font-size:12px">商品名</th>
        <th style="padding:8px 14px;text-align:center;color:#6B4A28;font-size:12px;width:50px">数量</th>
        <th style="padding:8px 14px;text-align:right;color:#6B4A28;font-size:12px;width:90px">金額</th>
      </tr>
      ${itemsHtml}
    </table>

    <!-- 合計 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF7EE;border-radius:8px;margin-bottom:22px">
      <tr><td style="padding:9px 16px;font-size:13px;color:#6B4A28">小計</td><td style="padding:9px 16px;text-align:right;color:#342010">¥${sub.toLocaleString('ja-JP')}</td></tr>
      <tr><td style="padding:9px 16px;font-size:13px;color:#6B4A28">送料</td><td style="padding:9px 16px;text-align:right;color:#342010">${ship === 0 ? '無料' : '¥' + ship.toLocaleString('ja-JP')}</td></tr>
      <tr style="border-top:2px solid #EAD5B8"><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#5C3317">合計</td><td style="padding:12px 16px;text-align:right;font-size:18px;font-weight:700;color:#A8660E">¥${total.toLocaleString('ja-JP')}</td></tr>
    </table>

    <p style="margin:0;font-size:11px;color:#9C7A58;text-align:center">このメールは自動送信されています。発送後は管理パネルから追跡番号を登録してください。</p>

  </td></tr>

  <tr><td style="background:#5C3317;border-radius:0 0 14px 14px;padding:18px 36px;text-align:center">
    <p style="margin:0;font-size:13px;color:#EFB96A;font-weight:700">米粉バウムクーヘン工房 未来図 — 注文管理システム</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  }

  else {
    return res.status(400).json({ error: `不明なtype: ${type}` });
  }

  if (!to) {
    return res.status(400).json({ error: '送信先メールアドレスがありません' });
  }

  // ── Resend APIで送信 ──
  try {
    // RESEND_USE_TEST_SENDER=true の場合 from を onboarding@resend.dev にする（テスト用）
    const fromAddress = USE_TEST_SENDER
      ? 'onboarding@resend.dev'
      : `米粉バウムクーヘン工房 未来図 <${FROM_EMAIL}>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, html }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(response.status).json({ error: data.message || 'Resend APIエラー', details: data });
    }

    return res.status(200).json({ success: true, id: data.id, to, subject });

  } catch (err) {
    console.error('Send email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
