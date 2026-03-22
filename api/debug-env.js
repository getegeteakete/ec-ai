// 一時デバッグ用 /api/debug-env
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // キーの存在のみ確認（値は返さない）
  res.status(200).json({
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_KEY_LEN: process.env.ANTHROPIC_API_KEY?.length || 0,
    ANTHROPIC_KEY_PREFIX: process.env.ANTHROPIC_API_KEY?.slice(0,10) || 'UNSET',
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  });
}
