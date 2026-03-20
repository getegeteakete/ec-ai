-- ============================================================
-- 未来図ECサイト Supabaseテーブル作成SQL
-- Supabaseダッシュボード → SQL Editor → New Query に貼り付けて実行
-- ============================================================

-- 注文テーブル
CREATE TABLE IF NOT EXISTS orders (
  id              BIGSERIAL PRIMARY KEY,
  order_no        TEXT NOT NULL UNIQUE,           -- #MIRAIS-XXXXXXXX
  order_date      TEXT NOT NULL,                  -- 注文日時
  status          TEXT NOT NULL DEFAULT 'pending', -- pending / paid / shipped / cancelled
  payment_method  TEXT DEFAULT 'credit_card',     -- 決済方法
  payment_id      TEXT DEFAULT '',                -- KOMOJUペイメントID
  session_id      TEXT DEFAULT '',                -- KOMOJUセッションID

  -- 顧客情報（JSONで保存）
  customer        JSONB NOT NULL DEFAULT '{}',
  -- 例: {"last":"山田","first":"花子","email":"...","tel":"...","zip":"...","pref":"...","addr1":"...","addr2":"...","note":"..."}

  -- 注文内容
  items           JSONB NOT NULL DEFAULT '[]',
  -- 例: [{"name":"...","size":"...","qty":1,"price":1600}]

  -- 金額
  sub             INTEGER NOT NULL DEFAULT 0,
  ship            INTEGER NOT NULL DEFAULT 0,
  discount        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,

  -- 発送情報
  tracking_no     TEXT DEFAULT '',
  tracking_url    TEXT DEFAULT '',
  receipt_sent    BOOLEAN DEFAULT FALSE,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_no   ON orders(order_no);

-- RLS（Row Level Security）設定
-- サービスロールキー（サーバー）は全アクセス可能
-- anonキー（フロントエンド）は読み取り禁止（管理パネルはサーバー経由）
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- サービスロールには全権限（Vercel Functionsが使用）
CREATE POLICY "service_role_all" ON orders
  FOR ALL USING (auth.role() = 'service_role');

-- 確認用クエリ
SELECT 'テーブル作成完了！' AS message;
SELECT COUNT(*) AS order_count FROM orders;
