# Card UI v2

採用モック:

- desktop-front-back-board-v2.png
- mobile-front-back-board-v3.png
- 実際のImageGen入力は prompts/desktop-front-back-v2.txt と prompts/mobile-front-back-v3.txt

main playとgroup-roomは、表裏で同じ shared-play-shell、shared-play-head、shared-question-card、shared-art-rail、shared-speaker 構造を使います。roomの未公開質問本文は取得せず、host/guest/loadingの操作契約とR18/pollingを維持しています。広告は既存配置だけです。

検証済み:

- 通常5viewport × group/solo 10件: 表裏位置、scroll、overflow、head、操作ターゲット PASS
- main操作: Enter/Space reveal、音切替、like、next/previous、pass PASS
- solo: memo draft保持、音再描画、次カードでmemo close PASS
- room: Enter/Space reveal、guest待機、loading pass disabled、bbox一致 PASS
- 8名320px、844×390横向き PASS
- 427文字DOMレイアウト負荷試験 PASS（custom保存テストではない）
- npm tests 216 passed

長文や狭い横画面では、文字を切らず自然な縦scrollを許容します。

QA画像・JSON・ログはローカル成果物として artifacts/card-ui-v2 に保存しており、commit対象外です。
