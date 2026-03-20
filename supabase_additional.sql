-- ============================================================
-- 未来図ECサイト 追加テーブル
-- Supabase → SQL Editor → New Query に貼り付けて実行
-- ============================================================

-- ① 商品テーブル（在庫管理）
CREATE TABLE IF NOT EXISTS products (
  id              BIGSERIAL PRIMARY KEY,
  wc_id           INTEGER UNIQUE,                    -- WooCommerce商品ID
  name            TEXT NOT NULL,
  short_desc      TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  price           INTEGER NOT NULL DEFAULT 0,
  sale_price      INTEGER DEFAULT NULL,
  category        TEXT DEFAULT 'other',              -- soft/hard/gift/other
  badge           TEXT DEFAULT '',                   -- pop/new/lim/sale
  badge_text      TEXT DEFAULT '',
  stock           INTEGER NOT NULL DEFAULT 99,       -- 在庫数
  stock_status    TEXT NOT NULL DEFAULT 'instock',   -- instock/outofstock/lowstock
  img_url         TEXT DEFAULT '',
  sizes           JSONB DEFAULT '[]',
  weight          TEXT DEFAULT '',
  size_info       TEXT DEFAULT '',
  allergen        TEXT DEFAULT '',
  ingredients     TEXT DEFAULT '',
  expiry          TEXT DEFAULT '',
  storage         TEXT DEFAULT '',
  active          BOOLEAN DEFAULT TRUE,              -- 公開/非公開
  sort_order      INTEGER DEFAULT 0,
  seo_title       TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ② 顧客テーブル
CREATE TABLE IF NOT EXISTS customers (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  last_name       TEXT DEFAULT '',
  first_name      TEXT DEFAULT '',
  tel             TEXT DEFAULT '',
  zip             TEXT DEFAULT '',
  prefecture      TEXT DEFAULT '',
  address1        TEXT DEFAULT '',
  address2        TEXT DEFAULT '',
  favorites       JSONB DEFAULT '[]',               -- お気に入り商品IDリスト
  total_orders    INTEGER DEFAULT 0,
  total_spent     INTEGER DEFAULT 0,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ③ アクセス解析テーブル
CREATE TABLE IF NOT EXISTS page_views (
  id          BIGSERIAL PRIMARY KEY,
  page        TEXT NOT NULL,                        -- home/products/detail/cart/complete
  product_id  INTEGER DEFAULT NULL,
  action      TEXT DEFAULT 'view',                  -- view/add_cart/purchase
  amount      INTEGER DEFAULT 0,
  session_id  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ④ AIコンテンツ生成履歴
CREATE TABLE IF NOT EXISTS ai_contents (
  id           BIGSERIAL PRIMARY KEY,
  product_id   INTEGER REFERENCES products(id),
  content_type TEXT NOT NULL,                       -- description/seo/instagram/twitter/blog
  prompt       TEXT DEFAULT '',
  content      TEXT NOT NULL,
  used         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- トリガー（updated_at自動更新）
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at  ON products;
DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER products_updated_at  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_products_active    ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX IF NOT EXISTS idx_customers_email    ON customers(email);
CREATE INDEX IF NOT EXISTS idx_page_views_page    ON page_views(page);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_contents_product ON ai_contents(product_id);

-- RLS設定
ALTER TABLE products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_contents ENABLE ROW LEVEL SECURITY;

-- service_role は全アクセス可能
CREATE POLICY "service_all_products"    ON products    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_customers"   ON customers   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_pageviews"   ON page_views  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_ai_contents" ON ai_contents FOR ALL USING (auth.role() = 'service_role');

-- anon（フロントエンド）はpage_viewsのINSERTのみ可能
CREATE POLICY "anon_insert_pageviews" ON page_views FOR INSERT WITH CHECK (true);

-- 既存商品データを products テーブルに初期投入
INSERT INTO products (wc_id, name, short_desc, price, category, badge, badge_text, stock, img_url, sizes, allergen, expiry, storage) VALUES
(1754,'米粉バウムクーヘン プレーン（ソフトタイプ）','佐賀県産無農薬米粉のふんわり食感。定番の人気No.1商品。',1600,'soft','pop','人気No.1',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2024/12/IMG_4247.png','["1個（約330g）"]','卵・乳成分・大豆','発送日より28日','直射日光・高温多湿を避け常温保存'),
(1757,'米粉バウムクーヘン プレーン（ハードタイプ）','モチっとした食感がクセになる。アーモンドパウダー入りで風味豊か。',1600,'hard','pop','定番人気',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2024/12/IMG_4249.jpeg','["1個（約300g）"]','卵・乳成分・大豆・アーモンド','発送日より28日','直射日光・高温多湿を避け常温保存'),
(2195,'★お試しセット★',               'はじめての方に。手軽に楽しめるお試しセット。',1000,'gift','sale','お試し',50,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2025/02/IMG_4951-scaled.jpeg','["セット内容は注文時に確認"]','卵・乳成分・大豆','各商品に準ずる','直射日光・高温多湿を避け常温保存'),
(1760,'米粉バウムクーヘン ハーフセット（2個入）','2つの味が楽しめるハーフカットセット。',1750,'gift',NULL,'',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2024/12/IMG_4251.jpeg','["2個入りセット"]','卵・乳成分・大豆','各商品に準ずる','直射日光・高温多湿を避け常温保存'),
(1765,'米粉バウムクーヘン ハーフセット（4個入）','4種類の味が楽しめるハーフカットセット。',3400,'gift','pop','人気セット',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2024/12/IMG_4256.jpeg','["4個入りセット"]','卵・乳成分・大豆','各商品に準ずる','直射日光・高温多湿を避け常温保存'),
(1772,'米粉バウムクーヘン ハーフセット（6個入）','6種類の味が揃うボリューム満点のハーフセット。',5050,'gift','new','ギフト人気',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2024/12/IMG_4262.jpeg','["6個入りセット"]','卵・乳成分・大豆','各商品に準ずる','直射日光・高温多湿を避け常温保存'),
(2029,'米粉バウムクッキー（プレーン：ハード）','ハードタイプのバウムクッキー。クセになる美味しさ！',600,'other',NULL,'',99,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2025/01/IMG_4318.jpeg','["1個（個包装）"]','卵・乳成分・アーモンド','製造日より30日','直射日光・高温多湿を避け常温保存'),
(2255,'クッキー缶【ミモザ缶】','可愛いミモザ缶に入ったクッキーセット。',700,'other','new','NEW',30,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2025/02/AOI_2808-scaled.jpg','["ミモザ缶1缶"]','卵・乳成分・アーモンド','製造日より30日','直射日光・高温多湿を避け常温保存'),
(2337,'【数量限定】お楽しみアウトレットBOX','数量限定のお得なアウトレットBOX。',2000,'other','lim','数量限定',10,'https://xn--gcks1h8a0bzhrc.com/wp-content/uploads/2025/03/IMG_4942-scaled.jpeg','["内容はお楽しみ"]','卵・乳成分・大豆','各商品に準ずる','直射日光・高温多湿を避け常温保存')
ON CONFLICT (wc_id) DO NOTHING;

SELECT 'テーブル作成・初期データ投入完了！' AS message;
SELECT name, price, stock FROM products ORDER BY id;
