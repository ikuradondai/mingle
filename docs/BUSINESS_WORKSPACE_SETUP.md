# 企業向け組織ワークスペース セットアップ

この文書は、現時点のローカル実装を確認するための運用メモです。Auth/Supabase設定は技術上の前提です。既存 security DB/env の準備待ちは本番公開運用上のholdであり、ここでは Push や deploy を行いません。

## 現在の利用フロー

1. verified なメールアドレスで既存のメール OTP ログインを行います。初回は既存のAuthフローがAuthアカウントを作成します。
2. 認証済みメールアドレスが事前登録された `email` と一致すると、初回の組織一覧取得時に会員が claim され、`pending` から `active` になります。CSVインポートはAuthアカウントを作らず、外部招待メールも送りません。
3. 組織ownerは組織を作成し、ownerを含めて1組織あたり最大500人を登録できます。owner自身はCSV件数には含まれませんが、DB上の上限はownerを含む500人です。

CSVはUTF-8 BOM付きテンプレートを使い、見出しは `email,display_name,department` 固定です。メール、呼び名、任意の部署だけを登録し、パスワードは含めません。元CSV本文は保存しません。1回のCSVは最大500行・256KiBです。同一CSV内のメール重複はエラー、既存組織会員はスキップされます。

## 権限と管理

- **owner**：admin/memberの管理、テーマ・機能ポリシー変更、組織削除。
- **admin**：memberの管理、テーマ・機能ポリシー変更。adminの変更はできません。
- **member**：許可されたセッションの開始のみ。

ownerは役割変更・停止の対象外です。Authメールを変更したownerを管理者が削除して再登録する運用は想定しません。ownerのメール変更などは運営問い合わせの対象です。

停止は会員レコードを保持したまま利用を止める操作です。会員削除は組織会員レコードだけを削除し、個人Authや個人データは削除しません。組織削除は組織、会員、ポリシーをcascade削除します。Authユーザー削除は紐付く組織会員を削除し、組織ownerのAuth削除は所有組織もcascade削除します。

## テーマと機能ポリシー

owner/adminは許可するテーマと、次の5つのboolean機能を設定できます。

- `group_play`：グループプレイ
- `solo_play`：ソロプレイ
- `theme_mix`：最大3テーマのミックス
- `audio`：効果音
- `theme_tags`：テーマタグ

少なくともgroupまたはsoloの一方は有効である必要があります。組織で選べるテーマは静的なnon-R18テーマだけです。テーマタグはブラウザlocalで扱い、orgadminへ送信しません。企業workspaceのセッションでは回答本文・録音・個人のプレイ履歴をサーバーへ保存せず、orgadminにも閲覧させません。

SSO、企業workspaceの通常テーマを自由編集する機能、企業向けの個人AI生成、請求・課金、監視analyticsは未実装です。法人カードマーケットの自社カードセット機能はこの制約とは別の追加entitlement機能です。既存の個人向けAI生成、個人カード、店舗機能の仕様を企業workspaceへ拡張したものではありません。

## URLと既存店舗導線

`business.mingle.cards` はVercel用ホストルーティングをコードに追加済みです。DNS、Vercel domain、Supabaseのallowed redirect URL設定は未反映です。既存店舗向けLPの `https://partnerplan.mingle.cards` は維持します。

## ローカル確認

PowerShellでPORT 4180を指定して起動します（既存の`.env.local`を読み込みます。値は表示・共有しません）。

```powershell
$env:PORT='4180'
npm start
```

ブラウザで `http://localhost:4180/business.html` を開き、OTPログイン、組織作成、CSVテンプレート、テーマ・機能設定、停止操作を確認します。Auth/Supabaseの設定がない場合は、企業エンドポイントが `503 BUSINESS_MIGRATION_UNAVAILABLE` になり、個人エンドポイントには影響しません。

## 法人アクティビティと会社クイズ

法人workspaceから、管理者が許可した場合だけ `/business-activities.html` を開けます。1on1スターター（相互理解・相談・振り返り）、会議前チェックイン、初日・1週目・1か月目のオンボーディング、同僚予想を提供します。オンボーディングの時期は利用者が選び、自動配信や進捗管理は行いません。会話の回答、録音、個人履歴は保存せず、同僚予想も端末内の一時状態だけで答え合わせします。

owner/adminは会社を知るクイズを作成・編集し、下書き（公開停止）または公開にできます。memberには公開済みだけを返し、別組織のコンテンツは返しません。問題・正解・解説は組織コンテンツとして保存しますが、社員の回答履歴や個人プロフィールには紐付けません。削除機能は未提供です。一般クイズは同じ入口から共通の公開クイズとして利用できます。

法人カードマーケットは別機能です。公式7会話活動の閲覧・利用は既存の無料機能として継続し、追加entitlementの有効期間中だけowner/adminが自社カードセットを作成・編集・複製・社内公開できます。公式セットのコピー導入は `POST .../card-market/official/:activityId/copy`、公開範囲は全社または既存memberのdepartmentです。memberは自分のdepartment対象セットだけを開始できます。entitlement付与は運営のservice-role/SQL操作に限り、価格・決済処理はこの実装に含めません。停止・管理者閲覧は期限切れ後も可能で、カード本文と社員回答は別々に扱い、回答は保存しません。

運営が手動でentitlementを付与・期限変更・停止するSQL例（説明用テンプレート。実行していません。`00000000-0000-0000-0000-000000000000`は対象organization UUIDに置換してください）:

```sql
-- 無期限付与（active_until NULL）
insert into public.organization_card_market_entitlements (organization_id, active_until, granted_by)
values ('00000000-0000-0000-0000-000000000000', null, null)
on conflict (organization_id) do update set active_until = excluded.active_until, updated_at = now();

-- 期限変更
update public.organization_card_market_entitlements
set active_until = timestamptz '2027-03-31 23:59:59+09', updated_at = now()
where organization_id = '00000000-0000-0000-0000-000000000000';

-- 利用停止（期限切れ扱い）
update public.organization_card_market_entitlements
set active_until = now() - interval '1 second', updated_at = now()
where organization_id = '00000000-0000-0000-0000-000000000000';
```

`active_until IS NULL`は無期限です。未設定・期限切れ後はmemberの作成・編集・複製・プレイを拒否しますが、owner/adminの一覧・detail・停止操作とデータ保持は可能です。これは運営DB操作の手順例であり、価格や決済を確定するものではありません。

## DB migration と検証

適用順は `supabase/migrations/202610140001_organizations.sql`（既存組織）→ `supabase/migrations/202610190001_business_activities.sql`（公式活動・会社クイズ）→ `supabase/migrations/202610190002_business_card_market.sql`（法人カードマーケット）です。前提migrationを適用していない環境では関連RPCが利用できず、企業画面は `503 BUSINESS_MIGRATION_UNAVAILABLE` を返します。本番DBへ適用する前に、既存のsecurity DB/env準備が完了している必要があります。

RLSとRPCのローカル検証は、リポジトリの依存関係が利用できる環境で次を再実行します。

```powershell
node tests/rls/organizations-verify.mjs
```

この検証はPGlite上で、anon/authenticatedの直接RPC拒否、ownerの組織数上限、メールclaim、member権限、CSV重複・入力エラー、停止、Auth削除cascade、組織削除時の会員・ポリシーcascadeを確認します。法人migrationの検証では、service_role以外のRPC拒否、active memberだけの活動取得、owner/adminだけのクイズ編集、memberへの下書き非表示、組織境界、機能ポリシーoff、問題本文の上限も確認してください。カードマーケットは `node tests/rls/business-marketplace-verify.mjs` でentitlement失効、department境界、member本文漏洩、version immutableを確認します。Supabase本番環境への接続や本番データ変更は行いません。
