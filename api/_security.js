// ============================================================
// 共通セキュリティヘルパー
// ============================================================

const ALLOWED_ORIGINS = [
  'https://ec-ai-three.vercel.app',
  'https://miraizu.vercel.app',
  // ローカル開発用
  'http://localhost:3000',
  'http://localhost:5173',
];

// インメモリレート制限（Vercel Function はリクエストごとに起動するため
// KV等を使う本格実装の代わりに、同一IPの短期スパム程度を防ぐ簡易版）
const rateStore = new Map();

export function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // fallback to first
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-auth-token');
  res.setHeader('Vary', 'Origin');
  // セキュリティヘッダー追加
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

export function rateLimit(req, res, maxReqs = 30, windowMs = 60000) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  const key = `${ip}:${req.url?.split('?')[0]}`;
  const now = Date.now();
  const entry = rateStore.get(key) || { count: 0, reset: now + windowMs };

  if (now > entry.reset) {
    entry.count = 1;
    entry.reset = now + windowMs;
  } else {
    entry.count++;
  }
  rateStore.set(key, entry);

  // 古いエントリを定期クリア
  if (rateStore.size > 1000) {
    for (const [k, v] of rateStore.entries()) {
      if (now > v.reset) rateStore.delete(k);
    }
  }

  if (entry.count > maxReqs) {
    res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
    return false; // レート超過
  }
  return true;
}

export function sanitizeString(str, maxLen = 500) {
  if (str === null || str === undefined) return '';
  return String(str).trim().slice(0, maxLen);
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

export function validateAdminToken(req) {
  const token = req.headers['x-admin-token'];
  const expected = process.env.ADMIN_PASSWORD;
  if (!token || !expected) return false;
  // タイミング攻撃対策（定数時間比較）
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
