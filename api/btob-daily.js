// ============================================================
// Vercel Function: /api/btob-daily
// 毎日JST9時に見込み企業5件の営業メールを自動生成
// ============================================================

const AI_KEY     = process.env.ANTHROPIC_API_KEY;
const SB_URL     = process.env.SUPABASE_URL;
const SB_KEY     = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const HOUJIN_KEY = process.env.HOUJIN_API_KEY;
const GMAPS_KEY  = process.env.GOOGLE_MAPS_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'shop@fukuoka-mirais.com';
const SHOP_EMAIL = process.env.RESEND_TO_EMAIL   || 'shop@fukuoka-mirais.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD    || 'mirais2024';

const ALLOWED = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  'http://localhost:3000',
];

const DAILY_TARGETS = [
  { industry:'hotel',    area:'福岡市内',   keyword:'ホテル 旅館',    label:'ホテル・旅館' },
  { industry:'wedding',  area:'福岡県全域', keyword:'ウェディング',   label:'ウェディング' },
  { industry:'office',   area:'福岡市内',   keyword:'企業 株式会社',  label:'企業・オフィス' },
  { industry:'gift',     area:'福岡県全域', keyword:'ギフト 百貨店',  label:'ギフトショップ・百貨店' },
  { industry:'hospital', area:'福岡市内',   keyword:'病院 クリニック',label:'病院・クリニック' },
];

const AREA_COORDS = {
  '福岡市内':   { lat:33.5904, lng:130.4017, radius:5000,  pref:'40' },
  '福岡県全域': { lat:33.5904, lng:130.4017, radius:50000, pref:'40' },
};

async function fetchGoogleMaps(keyword, area) {
  if (!GMAPS_KEY) return [];
  const coords = AREA_COORDS[area] || AREA_COORDS['福岡市内'];
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coords.lat},${coords.lng}&radius=${coords.radius}&keyword=${encodeURIComponent(keyword)}&language=ja&key=${GMAPS_KEY}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return (d.results||[]).slice(0,8).map(p=>({name:p.name,address:p.vicinity||'',source:'google_maps'}));
  } catch { return []; }
}

async function fetchHoujin(keyword, pref) {
  if (!HOUJIN_KEY) return [];
  const url = `https://api.houjin-bangou.nta.go.jp/v4/name?id=${HOUJIN_KEY}&name=${encodeURIComponent(keyword)}&mode=2&type=12&from=1&count=10&kind=01&change=0&close=1&divide=1&unitType=1${pref?'&prefecture='+pref:''}`;
  try {
    const r = await fetch(url,{headers:{Accept:'application/json'}});
    if(!r.ok) return [];
    const d = await r.json();
    return (d.corporations||[]).slice(0,8).map(c=>({name:c.name,address:`${c.prefectureName||''}${c.cityName||''}${c.streetNumber||''}`,source:'houjin',houjin_number:c.corporateNumber}));
  } catch { return []; }
}

async function generateLeadsAndEmails(target, gmResults, hjResults) {
  if (!AI_KEY) return [];
  const hasReal = gmResults.length > 0 || hjResults.length > 0;
  const realList = [...gmResults,...hjResults].map(r=>`・${r.name}（${r.address}）${r.houjin_number?'法人番号:'+r.houjin_number:''}`).join('\n');

  const prompt = hasReal
    ? `あなたは未来図（福岡の米粉バウムクーヘン専門店）のBtoB営業担当です。
【商品】米粉バウムクーヘン（グルテンフリー・手土産・ノベルティ） ¥600〜¥5,050 法人まとめ買い対応
連絡先: shop@fukuoka-mirais.com / 092-834-9856

【検索で見つかった実在企業（${target.label}・${target.area}）】
${realList}

上記から有望5社を選び、各社への営業メールも作成してください。
JSON配列のみ出力（他の文章不要）:
[{"name":"企業名","address":"住所","source":"google_maps/houjin","houjin_number":null,"score":85,"score_reason":"理由1文","approach":"アプローチ1文","estimated_amount":"想定取引額","email_subject":"件名30文字以内","email_body":"本文350〜500文字\n改行で"}]`
    : `あなたは未来図（福岡の米粉バウムクーヘン専門店）のBtoB営業担当です。
【商品】米粉バウムクーヘン（グルテンフリー・手土産・ノベルティ） ¥600〜¥5,050 法人まとめ買い対応
連絡先: shop@fukuoka-mirais.com / 092-834-9856

${target.area}の${target.label}業種で実在しそうな具体的な企業5社と、各社への営業メールを作成してください。
JSON配列のみ出力（他の文章不要）:
[{"name":"具体的企業名","address":"${target.area}の具体的住所","source":"ai_estimated","houjin_number":null,"score":80,"score_reason":"理由1文","approach":"アプローチ1文","estimated_amount":"想定取引額","email_subject":"件名30文字以内","email_body":"本文350〜500文字\n改行で"}]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':AI_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:4000,messages:[{role:'user',content:prompt}]}),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text||'[]';
    const match = text.match(/\[[\s\S]*\]/);
    if(!match) return [];
    return JSON.parse(match[0]).slice(0,5);
  } catch(e){ console.error('AI error:',e.message); return []; }
}

async function saveLead(lead, target, runDate) {
  if(!SB_URL||!SB_KEY) return lead;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/btob_leads`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Prefer':'return=representation'},
      body:JSON.stringify({
        company_name:lead.name,address:lead.address||'',source:lead.source||'ai',
        houjin_number:lead.houjin_number||null,industry:target.label,
        score:lead.score||0,score_reason:lead.score_reason||'',approach:lead.approach||'',
        email_subject:lead.email_subject||'',email_body:lead.email_body||'',
        status:'pending',run_date:runDate,created_at:new Date().toISOString(),
      }),
    });
    const d=await r.json(); return d[0]||lead;
  } catch(e){ console.error('Supabase:',e.message); return lead; }
}

async function sendNotification(leads, runDate, mode) {
  if(!RESEND_KEY||!leads.length) return;
  const rows=leads.map((l,i)=>`<tr><td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;font-size:13px"><strong>${i+1}. ${l.company_name||l.name}</strong><br><span style="font-size:11px;color:#6B4A28">${l.address||''}</span></td><td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;text-align:center"><span style="background:rgba(122,158,106,.15);color:#5C8040;padding:2px 8px;border-radius:50px;font-size:12px">${l.score||0}点</span></td><td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;font-size:12px;color:#6B4A28">${l.email_subject||''}</td></tr>`).join('');
  await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:`米粉バウムクーヘン工房 未来図 <${FROM_EMAIL}>`,to:[SHOP_EMAIL],
      subject:`🏢【未来図AI】本日のBtoB営業${leads.length}件 ${runDate}`,
      html:`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5ede0;font-family:'Hiragino Sans',sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="background:linear-gradient(135deg,#2d5a1b,#5C8040);border-radius:14px 14px 0 0;padding:28px 36px;text-align:center"><h1 style="margin:0;color:#fff;font-size:20px">🏢 本日のBtoB営業 ${leads.length}件</h1><p style="margin:6px 0 0;color:rgba(255,255,255,.75);font-size:13px">${runDate} 自動生成${mode==='ai_only'?' ／ AIのみモード':''}</p></td></tr><tr><td style="background:#fff;padding:28px 32px">${mode==='ai_only'?'<p style="font-size:12px;color:#e87400">⚠️ APIキー未設定のためAI推定モードで生成</p>':''}<table width="100%" cellpadding="0" cellspacing="0"><tr style="background:#FDF7EE"><th style="padding:9px 14px;text-align:left;color:#6B4A28;font-size:12px">企業名</th><th style="padding:9px 14px;text-align:center;color:#6B4A28;font-size:12px;width:60px">スコア</th><th style="padding:9px 14px;text-align:left;color:#6B4A28;font-size:12px">件名</th></tr>${rows}</table><div style="text-align:center;margin-top:20px"><a href="https://ec-ai-three.vercel.app/" style="display:inline-block;background:#5C8040;color:#fff;text-decoration:none;padding:12px 28px;border-radius:50px;font-size:14px;font-weight:700">管理パネルで確認・承認</a></div></td></tr><tr><td style="background:#5C3317;border-radius:0 0 14px 14px;padding:14px;text-align:center"><p style="margin:0;font-size:12px;color:#EFB96A">米粉バウムクーヘン工房 未来図 — BtoB営業AI</p></td></tr></table></td></tr></table></body></html>`,
    }),
  }).catch(e=>console.error('通知失敗:',e.message));
}

export default async function handler(req, res) {
  const origin=req.headers.origin||'';
  res.setHeader('Access-Control-Allow-Origin',ALLOWED.includes(origin)?origin:ALLOWED[0]);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, x-admin-token');
  if(req.method==='OPTIONS') return res.status(200).end();

  const isCron  =req.headers['x-vercel-cron']==='1';
  const isManual=req.headers['x-admin-token']===ADMIN_PASS;
  if(!isCron&&!isManual) return res.status(401).json({error:'認証エラー'});
  if(!AI_KEY) return res.status(500).json({error:'ANTHROPIC_API_KEY が未設定です'});

  const now    =new Date();
  const runDate=now.toLocaleDateString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'});
  const dayIdx =((now.getDay()+6)%7)%DAILY_TARGETS.length;
  const target =DAILY_TARGETS[dayIdx];
  const coords =AREA_COORDS[target.area]||AREA_COORDS['福岡市内'];

  const [gmResults,hjResults]=await Promise.all([
    fetchGoogleMaps(target.keyword,target.area),
    fetchHoujin(target.keyword.split(' ')[0],coords.pref),
  ]);

  const mode  =(gmResults.length>0||hjResults.length>0)?'full':'ai_only';
  const leads =await generateLeadsAndEmails(target,gmResults,hjResults);
  if(!leads.length) return res.status(200).json({success:false,message:'AI生成に失敗しました',runDate,target:target.label});

  const saved=[];
  for(const lead of leads){
    saved.push(await saveLead(lead,target,runDate));
    await new Promise(r=>setTimeout(r,300));
  }

  await sendNotification(saved,runDate,mode);

  return res.status(200).json({
    success:true,runDate,target:target.label,mode,
    generated:saved.length,supabase:!!SB_URL,
    results:saved.map(l=>({company:l.company_name||l.name,score:l.score,subject:l.email_subject,status:'pending'})),
  });
}
