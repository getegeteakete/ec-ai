// ============================================================
// Vercel Function: /api/ai-agent
// Claude APIを使ったコンテンツ自動生成
// content_type: description / seo / instagram / twitter / blog
//
// 【Vercel環境変数】ANTHROPIC_API_KEY = sk-ant-xxxxx
// ============================================================
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN  = process.env.ADMIN_PASSWORD || 'mirais2024';
const AI_KEY = process.env.ANTHROPIC_API_KEY;

const PROMPTS = {
  description: (p) => `
あなたは食品ECサイトの商品説明文ライターです。
以下の商品情報をもとに、購買意欲を高める魅力的な商品説明文を書いてください。

商品名: ${p.name}
価格: ¥${p.price}
カテゴリ: ${p.category}
アレルゲン: ${p.allergen}
賞味期限: ${p.expiry}
現在の説明: ${p.short_desc}

要件:
- 200〜300文字
- グルテンフリー・米粉の健康的な魅力を強調
- 贈り物としての価値もアピール
- 読みやすい日本語
- 改行を適切に使用
説明文のみを出力してください（タイトル・見出し不要）。`,

  seo: (p) => `
SEOの専門家として、以下の商品のSEOタイトルとメタディスクリプションを作成してください。

商品名: ${p.name}
価格: ¥${p.price}
ショップ名: 米粉バウムクーヘン工房 未来図（福岡）

以下のJSON形式のみで出力してください（説明不要）:
{
  "title": "SEOタイトル（32文字以内）",
  "description": "メタディスクリプション（120文字以内）",
  "keywords": ["キーワード1", "キーワード2", "キーワード3", "キーワード4", "キーワード5"]
}`,

  instagram: (p) => `
Instagramマーケティングの専門家として、以下の商品の投稿文を作成してください。

商品名: ${p.name}
価格: ¥${p.price}
ショップ: 米粉バウムクーヘン工房 未来図（福岡）
アカウント: @fukuoka_mirais

要件:
- 本文150〜200文字
- 絵文字を適切に使用（5〜8個）
- ハッシュタグ15〜20個（改行して末尾に）
- 購入を促すCTA（「プロフのリンクから↑」など）
- グルテンフリー・米粉の魅力を伝える
投稿文のみ出力してください。`,

  twitter: (p) => `
Xマーケティングの専門家として、以下の商品のポスト文を作成してください。

商品名: ${p.name}
価格: ¥${p.price}
ショップ: 米粉バウムクーヘン工房 未来図

要件:
- 120文字以内（URLスペース考慮）
- 絵文字2〜3個
- ハッシュタグ3〜4個
- 購買意欲を高める内容
ポスト文のみ出力してください。`,

  blog: (p) => `
食品ブログライターとして、以下の商品の紹介記事を書いてください。

商品名: ${p.name}
価格: ¥${p.price}
ショップ: 米粉バウムクーヘン工房 未来図（福岡市城南区）
アレルゲン: ${p.allergen}
賞味期限: ${p.expiry}

要件:
- 500〜700文字
- H2見出しを2〜3個使用（## 見出し の形式）
- グルテンフリー・小麦アレルギーの方へのメリットを含める
- 贈り物・ギフトとしての活用シーンを含める
- 自然な読み物として書く
記事本文のみ出力してください。`,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (req.headers['x-admin-token'] !== ADMIN)
    return res.status(401).json({ error: '認証エラー' });
  if (!AI_KEY)
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が未設定です' });

  const { product_id, content_type, custom_prompt } = req.body;
  if (!product_id || !content_type)
    return res.status(400).json({ error: 'product_id, content_type 必須' });

  // 商品情報をSupabaseから取得
  const pRes = await fetch(`${SB_URL}/rest/v1/products?id=eq.${product_id}`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
  });
  const products = await pRes.json();
  if (!products || products.length === 0)
    return res.status(404).json({ error: '商品が見つかりません' });
  const product = products[0];

  // プロンプト生成
  const promptFn = PROMPTS[content_type];
  if (!promptFn && !custom_prompt)
    return res.status(400).json({ error: '不正なcontent_type' });
  const prompt = custom_prompt || promptFn(product);

  try {
    // Claude API呼び出し
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         AI_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json();
      throw new Error(err.error?.message || 'Claude APIエラー');
    }

    const aiData = await aiRes.json();
    const content = aiData.content[0]?.text || '';

    // 生成履歴をSupabaseに保存
    await fetch(`${SB_URL}/rest/v1/ai_contents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       SB_KEY,
        'Authorization':`Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({ product_id, content_type, prompt, content }),
    });

    return res.status(200).json({ content, product_name: product.name, content_type });

  } catch (err) {
    console.error('AI error:', err);
    return res.status(500).json({ error: err.message });
  }
}
