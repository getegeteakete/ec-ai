// ============================================================
// Vercel Function: /api/btob-daily
// 毎日午前9時（JST）に自動実行する営業メール5件バッチ
//
// 【動作フロー】
// 1. 法人番号API + Google Maps で見込み企業を検索
// 2. AIが有望企業TOP5を選定・スコアリング
// 3. 各企業向けに営業メールを自動生成
// 4. Supabaseの btob_leads テーブルに「承認待ち」で保存
// 5. shop@宛に「本日の5件を確認してください」通知メールを送信
//
// 【Vercel Cron設定（vercel.json）】
//   "crons": [{ "path": "/api/btob-daily", "schedule": "0 0 * * 1-5" }]
//   → 月〜金 UTC 0:00 = JST 9:00
//
// 【Vercel環境変数】
//   HOUJIN_API_KEY / GOOGLE_MAPS_KEY / ANTHROPIC_API_KEY
//   SUPABASE_URL / SUPABASE_SERVICE_KEY
//   RESEND_API_KEY / RESEND_FROM_EMAIL
// ============================================================

const AI_KEY    = process.env.ANTHROPIC_API_KEY;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY= process.env.RESEND_API_KEY;
const FROM_EMAIL= process.env.RESEND_FROM_EMAIL || 'shop@fukuoka-mirais.com';
const SHOP_EMAIL= process.env.RESEND_TO_EMAIL   || 'shop@fukuoka-mirais.com';
const ADMIN_PASS= process.env.ADMIN_PASSWORD    || 'mirais2024';

const BASE_URL  = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://ec-ai-three.vercel.app';

const ALLOWED = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  'http://localhost:3000',
];

// ローテーションする業種・エリアの組み合わせ
// 曜日によって自動で変える（月=ホテル/火=ウェディング...）
const DAILY_TARGETS = [
  { industry: 'hotel',    area: 'fukuoka',        label: 'ホテル・旅館（福岡市内）' },
  { industry: 'wedding',  area: 'fukuoka-pref',   label: 'ウェディング（福岡県全域）' },
  { industry: 'office',   area: 'fukuoka',        label: '企業・オフィス（福岡市内）' },
  { industry: 'gift',     area: 'fukuoka-pref',   label: 'ギフトショップ（福岡県全域）' },
  { industry: 'hospital', area: 'fukuoka',        label: '病院・クリニック（福岡市内）' },
];

// ── Claude で営業メール生成 ──
async function generateSalesEmail(lead, tone = 'formal') {
  if (!AI_KEY) return null;

  const toneLabel = { formal: '丁寧・フォーマル', friendly: '親しみやすい', urgent: '限定感あり' }[tone] || '丁寧';

  const prompt = `未来図（福岡の米粉バウムクーヘン専門店）の営業担当として、以下の企業への初回営業メールを書いてください。

企業名: ${lead.name}
住所: ${lead.address}
業種: ${lead.type || ''}
アプローチヒント: ${lead.approach || ''}
メールトーン: ${toneLabel}

商品情報:
- 米粉バウムクーヘン（グルテンフリー・手土産・ノベルティ向け）
- 1個¥600〜¥5,050、法人まとめ買い・名入れ対応
- 問い合わせ: shop@fukuoka-mirais.com / 092-834-9856
- 公式サイト: https://ec-ai-three.vercel.app

以下のJSON形式のみを出力してください（他の文章不要）:
{
  "subject": "件名（30文字以内）",
  "body": "本文（400〜600文字。改行は\\nで）"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AI_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('Email generation error:', e.message);
    return null;
  }
}

// ── Supabase に btob_leads テーブルへ保存 ──
async function saveLeadToSupabase(lead, email, targetInfo, runDate) {
  if (!SB_URL || !SB_KEY) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/btob_leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        company_name:   lead.name,
        address:        lead.address,
        source:         lead.source || 'ai',
        houjin_number:  lead.houjin_number || null,
        industry:       targetInfo.label,
        score:          lead.score || 0,
        score_reason:   lead.score_reason || '',
        approach:       lead.approach || '',
        email_subject:  email?.subject || '',
        email_body:     email?.body || '',
        status:         'pending',   // pending / approved / sent / rejected
        run_date:       runDate,
        created_at:     new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`Supabase save failed: ${res.status}`);
    const data = await res.json();
    return data[0] || null;
  } catch (e) {
    console.error('Supabase save error:', e.message);
    return null;
  }
}

// ── shop@宛に本日の5件通知メール ──
async function sendDailyNotification(leads, runDate) {
  if (!RESEND_KEY || !leads.length) return;

  const leadsHtml = leads.map((l, i) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;font-size:13px;color:#342010">
        <strong>${i + 1}. ${l.company_name}</strong><br>
        <span style="font-size:11px;color:#6B4A28">📍 ${l.address}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;text-align:center;font-size:13px">
        <span style="background:rgba(122,158,106,.15);color:#5C8040;padding:2px 8px;border-radius:50px;font-weight:600">
          ${l.score}点
        </span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;font-size:12px;color:#6B4A28">
        ${l.email_subject}
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ede0;font-family:'Hiragino Sans','Noto Sans JP',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:linear-gradient(135deg,#2d5a1b,#5C8040);border-radius:14px 14px 0 0;padding:28px 36px;text-align:center">
    <p style="margin:0 0 6px;font-size:24px">🏢</p>
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">本日のBtoB営業 5件</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.75);font-size:13px">${runDate} 自動生成 ／ 承認してください</p>
  </td></tr>

  <tr><td style="background:#fff;padding:32px">
    <p style="margin:0 0 18px;font-size:14px;color:#342010;line-height:1.9">
      AIエージェントが本日の見込み企業5社への営業メールを自動生成しました。<br>
      管理パネルで内容を確認・承認してください。
    </p>

    <h3 style="margin:0 0 12px;font-size:14px;color:#5C3317;border-bottom:2px solid #EAD5B8;padding-bottom:8px">📋 本日の対象企業</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px">
      <tr style="background:#FDF7EE">
        <th style="padding:9px 14px;text-align:left;color:#6B4A28;font-size:12px">企業名</th>
        <th style="padding:9px 14px;text-align:center;color:#6B4A28;font-size:12px;width:60px">スコア</th>
        <th style="padding:9px 14px;text-align:left;color:#6B4A28;font-size:12px">メール件名</th>
      </tr>
      ${leadsHtml}
    </table>

    <div style="text-align:center">
      <a href="${BASE_URL}/#admin" style="display:inline-block;background:#5C8040;color:#fff;text-decoration:none;padding:13px 32px;border-radius:50px;font-size:14px;font-weight:700">
        🔍 管理パネルで確認・承認する
      </a>
    </div>

    <div style="background:#FDF7EE;border-radius:8px;padding:14px 18px;margin-top:18px;font-size:12px;color:#6B4A28">
      ⚠️ このメールは自動生成です。送信する前に必ず内容をご確認の上、承認操作を行ってください。
    </div>
  </td></tr>

  <tr><td style="background:#5C3317;border-radius:0 0 14px 14px;padding:16px 36px;text-align:center">
    <p style="margin:0;font-size:12px;color:#EFB96A;font-weight:700">米粉バウムクーヘン工房 未来図 — BtoB営業システム</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    `米粉バウムクーヘン工房 未来図 <${FROM_EMAIL}>`,
        to:      [SHOP_EMAIL],
        subject: `🏢【未来図AI】本日のBtoB営業5件 ${runDate}`,
        html,
      }),
    });
  } catch (e) {
    console.error('Notification email error:', e.message);
  }
}

// ── メインハンドラ ──
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 認証（Cron からはx-admin-tokenなし / 手動実行は必要）
  const isCron   = req.headers['x-vercel-cron'] === '1';
  const isManual = req.headers['x-admin-token'] === ADMIN_PASS;
  if (!isCron && !isManual) {
    return res.status(401).json({ error: '認証エラー' });
  }

  const now     = new Date();
  const runDate = now.toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
  // 曜日でターゲットをローテーション（0=日,1=月...）
  const dayIdx  = (now.getDay() + 6) % 7 % DAILY_TARGETS.length; // 月〜金 → 0〜4
  const target  = DAILY_TARGETS[dayIdx];

  console.log(`[btob-daily] 開始: ${runDate} / ターゲット: ${target.label}`);

  // 法人発掘APIを内部呼び出し
  let prospectData = null;
  try {
    const prospectRes = await fetch(`${BASE_URL}/api/btob-prospect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_PASS,
        'Origin': BASE_URL,
      },
      body: JSON.stringify({
        industry:  target.industry,
        area:      target.area,
        condition: '法人向けギフト・ノベルティ需要',
      }),
    });
    prospectData = await prospectRes.json();
  } catch (e) {
    console.error('Prospect fetch error:', e.message);
    return res.status(500).json({ error: `法人発掘エラー: ${e.message}` });
  }

  const aiLeads = prospectData?.ai_leads || [];
  if (!aiLeads.length) {
    return res.status(200).json({
      success: false,
      message: '見込み企業が見つかりませんでした（APIキー設定を確認してください）',
      runDate, target: target.label,
    });
  }

  // TOP5（最大5件）に絞って並列処理
  const top5    = aiLeads.slice(0, 5);
  const results = [];

  // 各企業のメール生成は並列で（APIレート制限に注意して少し間隔）
  for (const lead of top5) {
    try {
      // 曜日でトーンをローテーション
      const tones = ['formal', 'friendly', 'formal', 'urgent', 'formal'];
      const tone  = tones[results.length % tones.length];

      const email = await generateSalesEmail({
        name:     lead.name,
        address:  lead.address,
        type:     target.label,
        approach: lead.approach,
      }, tone);

      const saved = await saveLeadToSupabase(lead, email, target, runDate);
      results.push({ lead, email, saved, status: 'generated' });

      // API負荷分散のため少し待機
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error(`Lead processing error (${lead.name}):`, e.message);
      results.push({ lead, error: e.message, status: 'error' });
    }
  }

  // 通知メール送信
  const savedLeads = results
    .filter(r => r.saved)
    .map(r => ({ ...r.saved }));
  await sendDailyNotification(savedLeads, runDate);

  const summary = {
    success:    true,
    runDate,
    target:     target.label,
    generated:  results.filter(r => r.status === 'generated').length,
    errors:     results.filter(r => r.status === 'error').length,
    results:    results.map(r => ({
      company: r.lead?.name,
      score:   r.lead?.score,
      subject: r.email?.subject,
      status:  r.status,
      saved_id: r.saved?.id,
    })),
  };

  console.log('[btob-daily] 完了:', JSON.stringify(summary));
  return res.status(200).json(summary);
}
