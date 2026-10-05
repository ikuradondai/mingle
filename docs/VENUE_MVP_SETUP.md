# 店舗向けMingle.Cards MVP セットアップ

この機能は既存機能への追加です。グループ同時プレイは別の `/group-room.html` と専用APIで動作し、店舗QRのプレイ経路には含まれません。`supabase/migrations/202610070001_venues.sql` は自動適用されないため、既存のアカウント/共有セット用migrationの後に、内容をレビューしてからSupabaseへ適用してください。本タスクではproduction DBへ適用していません。`auth.users`、`auth.uid()`、既存のアカウントサービス設定で使うservice role（`SUPABASE_SERVICE_ROLE_KEY`等）が必要です。秘密情報はリポジトリに保存しません。

店舗管理入口は `/venue.html` です。卓上QRは `/?venue=<opaque-token>` へ遷移し、通常のMingle参加者・テーマ・カード・音声・パス・6枚区切りのプレイ体験を使います。QRはランダムtokenのSHA-256 hashと、所有者が別端末でも再印刷できるAES-GCM暗号化payloadを保存します。rotate後は旧QRで新しい開始ができず、revoke後は新しい読み込み/開始ができません。すでにブラウザへ読み込まれたカードを取り消す機能ではありません。service keyを変更して暗号payloadを復号できなくなった場合は、対象QRを再発行してください。

テーブルは店舗単位で管理し、公開ランディングで店舗が提供する有効なテーマを選べます。標準テーマまたは完成済みマイセットのスナップショットを保存するため、個人側の編集/削除後も店舗用コピーは変わりません。店舗所有者のアカウント削除時は、設定・提供テーマ・QR・利用集計をschemaのcascadeで削除します。

ロゴ、公式サイト、終了時リンクは初期MVPではHTTPS URL入力のみです。ロゴ画像のバイナリアップロードは含みません。来店者はログイン不要で、参加人数と呼び名はブラウザ/開始リクエスト内だけで扱います。R18テーマは店舗が有効化した場合だけ公開され、全員18歳以上かつ全員同意の既存文言で確認します。

利用集計は開始数と、実際に完了した6枚ブロック数、人気テーマだけを集計します。参加者名、回答文、音声内容は保存しません。匿名セッションはサーバー発行値をhash化し、店舗・テーマ・卓の組み合わせを検証して重複を除きます。

適用前に、使い捨てPostgreSQLでmigrationを2回実行し、`tests/rls/venue-rls.sql`を2回実行してください。このsmoke testはowner分離、匿名読み取り拒否、cross-tenant FK、owner外更新拒否、イベント重複排除、アカウント削除cascadeを確認します。Dockerでの実行結果は `artifacts/venue-mvp-postgres-fresh-final.txt` に保存しています。

## 将来構想：店舗検索（未実装）

### 店舗登録とMingle内マップ

店舗オーナーがセルフ登録し、店舗名、ロゴ、住所、業態、歓迎文、公式リンクを入力する。既存店舗はPlaces検索の候補からオーナーが選択し、同意のうえでGoogle `place_id` と緯度・経度を紐付ける。重複登録、メール確認、掲載同意、簡易審査を経て公開し、停止操作でMingleの公開一覧と地図から非表示にする。

Mingleサイト内ではGoogle Maps JavaScript APIとAdvanced Markersを使い、Mingle独自の「導入店」ピンを描画する。現在地（ブラウザの許可が必要）、エリア、駅、業態で検索し、地図/一覧を切り替え、店舗詳細から公式サイトや経路案内へ進める。これはMingleサイト内の表示であり、Google Maps本体へ「Mingle導入店」という独自ラベルを一括登録・表示する機能ではない。Google Business Profileの掲載・確認は各店舗がGoogleの手順で管理する。

Placesの`place_id`は保存できるが、Places/Geocodingの名称・住所・写真などの取得データを無制限に事前取得・恒久保存しない。表示時に必要な情報を再取得し、Googleの地図表示・ロゴ・帰属表示と利用規約を守る。Maps Platformは従量課金のため、APIキー制限、クォータ、予算アラートを設定する。参考資料：

- https://developers.google.com/maps/documentation/javascript/advanced-markers/start
- https://developers.google.com/maps/documentation/places/web-service/place-id
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://support.google.com/business/answer/7107242
- https://developers.google.com/maps/billing-and-pricing/manage-costs
