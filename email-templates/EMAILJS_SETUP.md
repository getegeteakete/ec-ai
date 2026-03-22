# 📧 EmailJS セットアップ手順書（未来図ECサイト）

## 送信されるメール一覧

| # | テンプレートID | 送信先 | タイミング |
|---|--------------|--------|-----------|
| ① | template_receipt | 顧客 | 決済完了後すぐ自動送信 |
| ② | template_tracking | 顧客 | 管理パネルで追跡番号登録時 |
| ③ | template_shop_notify | 店舗（info@fukuoka-mirais.com） | 注文が入るたびに自動送信 |

---

## STEP 1：EmailJSアカウント作成

1. https://www.emailjs.com/ にアクセス
2. 「Sign Up Free」でアカウント作成
3. 無料プランで **月200通** まで送信可能
   - 有料プランは月1000通〜（約$15/月〜）

---

## STEP 2：Gmailサービスを接続

1. 左メニュー「Email Services」→「Add New Service」
2. 「Gmail」を選択
3. Googleアカウント（info@fukuoka-mirais.com）でログイン・許可
4. **Service ID** をメモ（例：`service_abc123`）

---

## STEP 3：メールテンプレートを3つ作成

左メニュー「Email Templates」→「Create New Template」

### テンプレート①：注文確認メール（顧客宛）

| 設定項目 | 値 |
|---------|-----|
| Template Name | 注文確認メール |
| Template ID | `template_receipt` |
| Subject | 【未来図】ご注文ありがとうございます（{{order_id}}） |
| To Email | {{to_email}} |
| From Name | 米粉バウムクーヘン工房 未来図 |
| Reply To | info@fukuoka-mirais.com |

**Content（HTMLタブ）：** `template_receipt.html` の内容をコピペ

---

### テンプレート②：発送通知メール（顧客宛）

| 設定項目 | 値 |
|---------|-----|
| Template Name | 発送通知メール |
| Template ID | `template_tracking` |
| Subject | 【未来図】ご注文商品を発送しました（{{order_id}}） |
| To Email | {{to_email}} |
| From Name | 米粉バウムクーヘン工房 未来図 |
| Reply To | info@fukuoka-mirais.com |

**Content（HTMLタブ）：** `template_tracking.html` の内容をコピペ

---

### テンプレート③：新規注文通知メール（店舗宛）

| 設定項目 | 値 |
|---------|-----|
| Template Name | 店舗注文通知 |
| Template ID | `template_shop_notify` |
| Subject | 🔔【未来図】新規注文：{{order_id}}（¥{{total}}） |
| To Email | {{to_email}} ← shopParamsで info@fukuoka-mirais.com を渡す |
| From Name | 未来図 注文管理システム |
| Reply To | {{customer_email}} ← 顧客に直接返信できる |

**Content（HTMLタブ）：** `template_shop_notify.html` の内容をコピペ

---

## STEP 4：Public Keyを取得

1. 右上のアカウントアイコン → 「Account」
2. 「API Keys」タブ → **Public Key** をコピー

---

## STEP 5：index.html の EMAILJS_CONFIG を更新

```javascript
const EMAILJS_CONFIG = {
  publicKey:   'user_xxxxxxxxxxxxxxxx',  // ← Public Keyを貼り付け
  serviceId:   'service_xxxxxxxx',       // ← Step2のService IDを貼り付け
  receiptTpl:  'template_receipt',       // そのまま
  trackingTpl: 'template_tracking',      // そのまま
  shopTpl:     'template_shop_notify',   // そのまま
  shopEmail:   'info@fukuoka-mirais.com',// そのまま
};
```

---

## STEP 6：テスト送信

EmailJSの各テンプレート画面から「Test It」でテスト送信が可能です。

変数の確認：
- `{{to_name}}` → 山田 花子
- `{{order_id}}` → #MIRAIS-XXXXXXXX
- `{{total}}` → ¥3,200
- `{{item_list_html}}` → 商品テーブルの行HTML
- `{{tracking_no}}` → 1234-5678-9012（②のみ）
- `{{tracking_url}}` → ヤマト追跡URL（②のみ）

---

## 月間送信数の目安

| 注文件数/月 | 必要送信数 |
|------------|----------|
| 〜50件 | 150通（無料枠内） |
| 〜100件 | 300通（有料プラン推奨） |

無料枠200通 = 注文66件/月まで無料  
（①注文確認 + ③店舗通知 = 1注文で2通消費）
