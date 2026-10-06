# Creator UI refresh

承認済みの built-in imagegen board を視覚リファレンスとして、既存の機能境界を保った creator UI を実装しました。

## 採用リファレンス

- [desktop board v3](./desktop-creator-ui-board-v3.png)
- [mobile board v3](./mobile-creator-ui-board-v3.png)
- [desktop prompt](./prompts/desktop-creator-ui-v3.txt)
- [mobile prompt](./prompts/mobile-creator-ui-v3.txt)

画面名は「マーケットプレイス」「質問を作る」「テーマを作る」「マイセット」に統一。公式ロゴ、cream/navy/cobalt/coral、既存 family artwork を使い、upload・画像生成・未確認の推薦機能は追加していません。マーケットプレイスの主要操作はインポート、詳細、いいねです。

## 実装契約

- library dialog は `width:min(1120px,100%)`、内側 main のみ縦スクロールを担当し、1024/900/390px でも横overflowを作りません。
- 質問 editor は本文→R18→プレビュー→保存の順。テーマ editor は質問一覧、8 preset swatch、preview、保存を同じ編集画面に保持します。swatch と preview は実 play と同じ BACK artwork を使います。
- R18 は手動指定を初期 off とし、子質問に R18 がある場合は checked/disabled の自動状態を表示します。自動判定の解除操作は表示しません。既存の年齢確認・R18表示同意を維持します。
- design descriptor は `{version:1,kind:'preset',presetId:'...'}`。legacy の未指定値は既存 fallback を使い、未知 preset は正規化で拒否します。将来の asset/upload 系 descriptor は別の kind を追加します。
- SQL migration `supabase/migrations/202610110002_creator_metadata.sql` は本番へ自動適用しません。追加SQL未適用時は既存読取りと既存プレイをlegacy fallbackで維持します。新しいdesign/R18 metadataの保存・公開・import・share・playを使うには、このmigrationを先に適用してください。

## 検証

`C:/temp/mingle-qa/creator-ui-v3.mjs` の fixture browser QA を実行し、実導線で library→テーマ editor→質問 editor を確認しました。UUID形式のcustom card、R18 storage、メモリAPI fixtureを使い、safe/R18質問保存、8 swatch選択、テーマ編集、0〜5問下書き、子R18のchecked/disabledと削除後の自動解除・手動維持、1366/1024/900/390pxの横overflow=0、nav current=1をassertしました。pageerror は0です。生成スクリーンショットは `C:/dev/carding/site/artifacts/creator-ui-*.png` に保存されています。

この README と board/prompt は設計成果物です。QA logs と artifacts はローカル検証成果物であり、commit 対象には含めません。
