-- ============================================================
-- Supabase: btob_leads テーブル
-- BtoB営業の見込み企業リストと生成メールを管理
-- ============================================================

CREATE TABLE IF NOT EXISTS btob_leads (
  id              BIGSERIAL PRIMARY KEY,
  company_name    TEXT NOT NULL,
  address         TEXT DEFAULT '',
  source          TEXT DEFAULT 'ai',        -- 'google_maps' | 'houjin' | 'ai'
  houjin_number   TEXT,                     -- 法人番号（あれば）
  industry        TEXT DEFAULT '',           -- 業種ラベル
  score           INTEGER DEFAULT 0,         -- AIスコア 0-100
  score_reason    TEXT DEFAULT '',
  approach        TEXT DEFAULT '',
  email_subject   TEXT DEFAULT '',
  email_body      TEXT DEFAULT '',
  status          TEXT DEFAULT 'pending',    -- pending/approved/sent/rejected
  run_date        TEXT DEFAULT '',           -- 'YYYY/MM/DD' 実行日
  sent_at         TIMESTAMPTZ,              -- 送信済み日時
  note            TEXT DEFAULT '',          -- 担当者メモ
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_btob_leads_status   ON btob_leads(status);
CREATE INDEX IF NOT EXISTS idx_btob_leads_run_date ON btob_leads(run_date);
CREATE INDEX IF NOT EXISTS idx_btob_leads_created  ON btob_leads(created_at DESC);

-- RLS（Row Level Security）は無効化してサービスキーで操作
ALTER TABLE btob_leads DISABLE ROW LEVEL SECURITY;

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_btob_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER btob_leads_updated_at
  BEFORE UPDATE ON btob_leads
  FOR EACH ROW EXECUTE FUNCTION update_btob_leads_updated_at();
