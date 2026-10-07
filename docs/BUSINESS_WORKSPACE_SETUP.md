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

SSO、企業所有のカスタムテーマ、企業向けの個人AI生成、請求・課金、監視analyticsは未実装です。既存の個人向けAI生成、個人カード、店舗機能の仕様を企業workspaceへ拡張したものではありません。

## URLと既存店舗導線

`business.mingle.cards` はVercel用ホストルーティングをコードに追加済みです。DNS、Vercel domain、Supabaseのallowed redirect URL設定は未反映です。既存店舗向けLPの `https://partnerplan.mingle.cards` は維持します。

## ローカル確認

PowerShellでPORT 4180を指定して起動します（既存の`.env.local`を読み込みます。値は表示・共有しません）。

```powershell
$env:PORT='4180'
npm start
```

ブラウザで `http://localhost:4180/business.html` を開き、OTPログイン、組織作成、CSVテンプレート、テーマ・機能設定、停止操作を確認します。Auth/Supabaseの設定がない場合は、企業エンドポイントが `503 BUSINESS_MIGRATION_UNAVAILABLE` になり、個人エンドポイントには影響しません。

## DB migration と検証

本機能のmigrationは `supabase/migrations/202610140001_organizations.sql` です。本番DBへ適用する前に、既存のsecurity DB/env準備が完了している必要があります。

RLSとRPCのローカル検証は、リポジトリの依存関係が利用できる環境で次を再実行します。

```powershell
node tests/rls/organizations-verify.mjs
```

この検証はPGlite上で、anon/authenticatedの直接RPC拒否、ownerの組織数上限、メールclaim、member権限、CSV重複・入力エラー、停止、Auth削除cascade、組織削除時の会員・ポリシーcascadeを確認します。Supabase本番環境への接続や本番データ変更は行いません。
