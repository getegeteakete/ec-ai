// ============================================================
// Vercel Function: /api/btob-prospect
// 法人番号API（国税庁）+ Google Maps Places API で
// 実在する見込み法人を検索・スコアリング・AI分析
//
// 【Vercel環境変数】
//   HOUJIN_API_KEY    = 法人番号APIアプリケーションID
//   GOOGLE_MAPS_KEY   = Google Maps API Key（Places API有効化必要）
//   ANTHROPIC_API_KEY = Claude API Key
// ============================================================

const HOUJIN_KEY  = process.env.HOUJIN_API_KEY;
const GMAPS_KEY   = process.env.GOOGLE_MAPS_KEY;
const AI_KEY      = process.env.ANTHROPIC_API_KEY;
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'mirais2024';

const ALLOWED = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  'http://localhost:3000',
];

// 業種→検索キーワードマッピング
const INDUSTRY_KEYWORDS = {
  hotel:    ['ホテル', '旅館', '温泉宿', 'リゾート'],
  wedding:  ['ウェディング', '結婚式場', 'ブライダル'],
  office:   ['株式会社', '合同会社', '総合病院', '銀行'],
  cafe:     ['カフェ', '喫茶店', 'ベーカリー', 'レストラン'],
  gift:     ['百貨店', 'ギフトショップ', '菓子店', 'セレクトショップ'],
  nursery:  ['保育園', '幼稚園', '認定こども園', '学童保育'],
  hospital: ['病院', 'クリニック', '医院', '歯科'],
  beauty:   ['美容院', 'エステサロン', 'ネイルサロン'],
  sport:    ['スポーツジム', 'フィットネス', 'ヨガ', 'スポーツクラブ'],
};

// エリア→緯度経度・法人番号API地域コードマッピング
const AREA_MAP = {
  fukuoka:        { lat: 33.5904,  lng: 130.4017, radius: 5000,  pref: '40', name: '福岡市内' },
  'fukuoka-pref': { lat: 33.5904,  lng: 130.4017, radius: 50000, pref: '40', name: '福岡県全域' },
  kyushu:         { lat: 33.0000,  lng: 131.0000, radius: 200000,pref: '',   name: '九州全域' },
  tokyo:          { lat: 35.6762,  lng: 139.6503, radius: 10000, pref: '13', name: '東京都' },
  osaka:          { lat: 34.6937,  lng: 135.5023, radius: 10000, pref: '27', name: '大阪府' },
  nagoya:         { lat: 35.1815,  lng: 136.9066, radius: 10000, pref: '23', name: '愛知県' },
};

// ── Google Maps Places API で企業を検索 ──
async function searchByGoogleMaps(industry, area, additionalKeyword = '') {
  if (!GMAPS_KEY) return { source: 'google_maps', error: 'GOOGLE_MAPS_KEY未設定', results: [] };

  const areaInfo  = AREA_MAP[area] || AREA_MAP['fukuoka'];
  const keywords  = INDUSTRY_KEYWORDS[industry] || ['企業'];
  const keyword   = (keywords[0] + (additionalKeyword ? ' ' + additionalKeyword : ''));

  // Places API Nearby Search
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
    `location=${areaInfo.lat},${areaInfo.lng}` +
    `&radius=${areaInfo.radius}` +
    `&keyword=${encodeURIComponent(keyword)}` +
    `&language=ja` +
    `&key=${GMAPS_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return { source: 'google_maps', error: data.status, results: [] };
    }

    const results = (data.results || []).slice(0, 10).map(p => ({
      source:     'google_maps',
      place_id:   p.place_id,
      name:       p.name,
      address:    p.vicinity || '',
      rating:     p.rating || null,
      user_ratings_total: p.user_ratings_total || 0,
      business_status: p.business_status || 'OPERATIONAL',
      types:      p.types || [],
      location:   p.geometry?.location || {},
    }));

    return { source: 'google_maps', area: areaInfo.name, keyword, results };
  } catch (e) {
    return { source: 'google_maps', error: e.message, results: [] };
  }
}

// ── 法人番号API で法人を検索 ──
async function searchByHoujinApi(keyword, prefecture = '') {
  if (!HOUJIN_KEY) return { source: 'houjin', error: 'HOUJIN_API_KEY未設定', results: [] };

  let url = `https://api.houjin-bangou.nta.go.jp/v4/name?` +
    `id=${HOUJIN_KEY}` +
    `&name=${encodeURIComponent(keyword)}` +
    `&mode=2` +  // 前方一致
    `&type=12` + // 全法人種別
    `&from=1&count=15` +
    `&kind=01` + // 法人名検索
    `&change=0&close=1&divide=1` +
    `&unitType=1`; // JSON形式

  if (prefecture) url += `&prefecture=${prefecture}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      return { source: 'houjin', error: `HTTP ${res.status}`, results: [] };
    }

    const data = await res.json();
    const corporations = data.corporations || [];

    const results = corporations.slice(0, 10).map(c => ({
      source:          'houjin',
      houjin_number:   c.corporateNumber,
      name:            c.name,
      furigana:        c.furigana || '',
      address:         `${c.prefectureName || ''}${c.cityName || ''}${c.streetNumber || ''}`,
      post_code:       c.postCode || '',
      status:          c.process || '',
      kind:            c.kind || '',
      update_date:     c.updateDate || '',
    }));

    return { source: 'houjin', keyword, count: data.count || 0, results };
  } catch (e) {
    return { source: 'houjin', error: e.message, results: [] };
  }
}

// ── Claude AIで企業をスコアリング＆アプローチ提案 ──
async function analyzeLeadsWithAI(googleResults, houjinResults, industry, condition) {
  if (!AI_KEY) return null;

  const industryLabel = {
    hotel:'ホテル・旅館', wedding:'ウェディング', office:'企業・オフィス',
    cafe:'カフェ・飲食店', gift:'ギフト・百貨店', nursery:'保育園・幼稚園',
    hospital:'病院・クリニック', beauty:'美容サロン', sport:'スポーツジム'
  }[industry] || industry;

  const googleList = googleResults.map(r =>
    `・${r.name}（${r.address}）評価:${r.rating||'不明'}`
  ).join('\n');

  const houjinList = houjinResults.map(r =>
    `・${r.name}（${r.address}）法人番号:${r.houjin_number}`
  ).join('\n');

  const prompt = `
あなたは未来図（福岡の米粉バウムクーヘン専門店）のBtoB営業戦略アドバイザーです。

【未来図の商品】
- 米粉バウムクーヘン（グルテンフリー・手土産・ノベルティ向け）
- 1個¥600〜¥5,050、法人まとめ買い・名入れ対応
- 問い合わせ: info@fukuoka-mirais.com / 092-834-9856

【検索対象業種】${industryLabel}
【追加条件】${condition || 'なし'}

【Googleマップから見つかった企業】
${googleList || '（データなし）'}

【法人番号APIから見つかった法人】
${houjinList || '（データなし）'}

上記の実在企業の中から、未来図のBtoB営業として特に有望な企業を5社選んで、以下のJSON配列のみを出力してください（説明不要）：
[
  {
    "name": "企業名",
    "address": "住所",
    "source": "google_maps または houjin",
    "houjin_number": "法人番号（あれば）",
    "score": 85,
    "score_reason": "なぜ有望か（1文）",
    "approach": "具体的な営業アプローチ（1〜2文）",
    "estimated_amount": "想定年間取引額",
    "timing": "最適な営業タイミング"
  }
]`;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '[]';
    // JSONを抽出
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (e) {
    console.error('AI analysis error:', e);
    return null;
  }
}

// ── メインハンドラ ──
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 認証
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_PASS) {
    return res.status(401).json({ error: '認証エラー' });
  }

  const { industry, area, condition, mode } = req.body || {};
  if (!industry || !area) {
    return res.status(400).json({ error: 'industry と area は必須です' });
  }

  const areaInfo   = AREA_MAP[area] || AREA_MAP['fukuoka'];
  const keywords   = INDUSTRY_KEYWORDS[industry] || ['企業'];

  try {
    // ── 並列で両APIを検索 ──
    const [gmapsData, houjinData] = await Promise.all([
      searchByGoogleMaps(industry, area, condition),
      searchByHoujinApi(keywords[0], areaInfo.pref),
    ]);

    // AI分析（企業スコアリング）
    const aiLeads = await analyzeLeadsWithAI(
      gmapsData.results,
      houjinData.results,
      industry,
      condition
    );

    return res.status(200).json({
      success:      true,
      area:         areaInfo.name,
      industry,
      google_maps:  gmapsData,
      houjin:       houjinData,
      ai_leads:     aiLeads,      // AIが選んだ有望企業TOP5
      total_found:  (gmapsData.results?.length || 0) + (houjinData.results?.length || 0),
    });

  } catch (e) {
    console.error('btob-prospect error:', e);
    return res.status(500).json({ error: e.message });
  }
}
