// ============================================================
// Vercel Function: /api/auth
// POST /api/auth?action=register  → 会員登録
// POST /api/auth?action=login     → ログイン
// GET  /api/auth?action=me        → マイページ情報取得
// PUT  /api/auth?action=favorites → お気に入り同期
// ============================================================
import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SECRET = process.env.AUTH_SECRET || 'mirais_auth_secret_2024';

const sb = (path, opts={}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { 'Content-Type':'application/json', 'apikey':SB_KEY,
    'Authorization':`Bearer ${SB_KEY}`, 'Prefer':'return=representation', ...(opts.headers||{}) },
});

const hashPw = (pw) => crypto.createHmac('sha256', SECRET).update(pw).digest('hex');
const makeToken = (email) => Buffer.from(`${email}:${Date.now()}:${SECRET}`).toString('base64');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-auth-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── 会員登録 ──
  if (action === 'register' && req.method === 'POST') {
    const { email, password, last_name, first_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email・passwordは必須です' });
    if (password.length < 8)  return res.status(400).json({ error: 'パスワードは8文字以上' });

    const check = await sb(`customers?email=eq.${encodeURIComponent(email)}&select=id`);
    const exists = await check.json();
    if (exists.length > 0) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });

    const r = await sb('customers', {
      method: 'POST',
      body: JSON.stringify({ email, password_hash: hashPw(password), last_name, first_name }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: 'メールアドレスが無効です' });

    const customer = data[0];
    const token = makeToken(email);
    return res.status(201).json({
      token, customer: { id: customer.id, email, last_name, first_name, favorites: [] },
    });
  }

  // ── ログイン ──
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email・password必須' });

    const r = await sb(`customers?email=eq.${encodeURIComponent(email)}`);
    const data = await r.json();
    if (!data.length || data[0].password_hash !== hashPw(password))
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

    const customer = data[0];
    // last_loginを更新
    await sb(`customers?id=eq.${customer.id}`, {
      method: 'PATCH', body: JSON.stringify({ last_login: new Date().toISOString() }),
    });

    const token = makeToken(email);
    return res.status(200).json({
      token,
      customer: {
        id: customer.id, email: customer.email,
        last_name: customer.last_name, first_name: customer.first_name,
        favorites: customer.favorites || [],
        total_orders: customer.total_orders, total_spent: customer.total_spent,
      },
    });
  }

  // ── マイページ情報取得（注文履歴含む） ──
  if (action === 'me' && req.method === 'GET') {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: '認証トークンがありません' });

    const email = Buffer.from(token, 'base64').toString().split(':')[0];
    if (!email) return res.status(401).json({ error: '無効なトークン' });

    const [custRes, orderRes] = await Promise.all([
      sb(`customers?email=eq.${encodeURIComponent(email)}`),
      sb(`orders?customer->>'email'=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=20`),
    ]);

    const customers = await custRes.json();
    if (!customers.length) return res.status(404).json({ error: '顧客が見つかりません' });

    const orders = await orderRes.json();
    const customer = customers[0];

    return res.status(200).json({
      customer: {
        id: customer.id, email: customer.email,
        last_name: customer.last_name, first_name: customer.first_name,
        tel: customer.tel, zip: customer.zip,
        prefecture: customer.prefecture, address1: customer.address1,
        favorites: customer.favorites || [],
        total_orders: customer.total_orders, total_spent: customer.total_spent,
      },
      orders,
    });
  }

  // ── お気に入り同期 ──
  if (action === 'favorites' && req.method === 'PUT') {
    const token = req.headers['x-auth-token'];
    const { favorites } = req.body;
    if (!token) return res.status(401).json({ error: '認証トークンがありません' });

    const email = Buffer.from(token, 'base64').toString().split(':')[0];
    await sb(`customers?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', body: JSON.stringify({ favorites }),
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: '不正なリクエスト' });
}
