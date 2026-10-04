# Mingle.Cards Set Studio 概念設計

## 目的

Set Studio は、Mingle.Cards の質問セットを「作る・整える・遊ぶ・共有する」ための専用スペースである。既製カードを大量に並べて選ばせる画面ではなく、本人のテーマから小さなセットを育てる体験を中心にする。既存の pop / navy / blue / coral / cream は維持するが、説明文を増やさず、カードと次の行動を優先してスクロール量を抑える。

セットは「編集状態」と「公開範囲」の2軸で扱う。

| 軸 | 値 | 意味 |
| --- | --- | --- |
| 編集状態 | `draft` | 0〜40枚の編集中。保存でき、6枚未満でも残せる |
| 編集状態 | `ready` | 6〜40枚で遊べる完成セット |
| 公開範囲 | `private` | 本人だけが見られる。AI生成直後や保存済みdraftを含む |
| 公開範囲 | `published` | phase 2以降の公開snapshot。元セットの編集状態とは別に管理する |

保存は「自分のセットとして下書きを残す」、遊ぶは「質問をランダムに開始する」、公開は「他者が発見・無料importできるsnapshotを出す」と明確に分ける。AI生成結果は自動公開せず、必ず本人の確認・編集を経てprivateに保存する。6枚以上で「セットを保存」すると、内容を検証したうえで承認を兼ねて`ready`になる。6枚未満は「下書き保存」で`draft`として残す。

## Phase 1（現在の実装）

### 一覧

専用の Set Studio 一覧に、My sets と Favorites をまとめる。各セットは名前、枚数、編集状態、Play/Edit の主要アクションだけを表示する。0〜5枚のdraftも「下書き保存」で一覧へ戻せるため、「1〜5枚は保存できない」問題を解消する。6〜40枚のreadyだけPlayを有効にし、draftは「あとN枚でPlay」と短く示す。readyセットを編集するときは、元のreadyを保持したまま編集draftとして表示する。

既存の `favorites`、`custom`、`private_sets`、`shared_links` とSupabase independent accountを利用する。ゲストは最初の6枚を遊べ、login後に同じ作業を継続できる。セットの作成・保存は登録ユーザー向けとする。

### Editor

Editorは「セット名」「カード項目」「追加」を中心に置く。カードは一枚ずつ編集でき、セットから外す操作とfavorite操作は分ける。セットからカードを外してもfavoriteは解除せず、favoriteの追加・入替・解除は独立したfavorite管理画面で行う。カードの順番変更は今回実装せず、Play時はランダムに出す。順番を固定する並べ替えは将来の有料機能候補として扱う。作業中は自動公開せず、6枚未満は「下書き保存」、6枚以上は「セットを保存」を主ボタンにする。6枚以上の「セットを保存」は承認を兼ねてreadyへ進める。

### Picker

Pickerは、favoriteと本人のcustomカードから選ぶ、新規カードを手入力する、の導線に絞る。既製カードbank全体の閲覧を既定の導線にしない。favorite本文は画面内の本人データとして扱い、AI生成リクエストには送らない。favoriteの追加・入替・解除は独立したfavorite管理画面で行い、セットから外す操作とは別に扱う。

### AI preview

「テーマ」「トーン」「6枚 / 12枚」を入力してGenerateする。AIは日本語の相互自己開示を促す独自質問だけを新規生成する。結果はPreviewで一枚ずつ編集・削除でき、`r18:false`を初期値にする。Previewから採用した結果はlocal draftとして保存し、6枚以上で「セットを保存」を押した時点で承認を兼ねてreadyにする。自動公開はしない。失敗時は既存のdraftを壊さず、再試行できる。

## AI生成API（Phase 1）

クライアントは次の認証済みAPIだけを呼ぶ。OpenAI API keyはブラウザへ渡さず、runtime serverの`OPENAI_API_KEY`だけが使用する。

```http
POST /api/account/ai/questions
Authorization: Bearer <session>
Content-Type: application/json
```

```json
{
  "theme": "最近もっと知りたいこと",
  "tone": "あたたかく、少し遊び心",
  "count": 6
}
```

`theme`は空でない短い文字列、`tone`は任意の短い文字列、`count`は整数6または12だけを受け付ける。返却値は次の形に固定する。

```json
{
  "name": "夜の小さな好奇心",
  "questions": [
    { "text": "最近、誰かに話したくなった小さな発見は？", "r18": false }
  ]
}
```

サーバーはセッションを必須にし、アカウント単位の設定可能なquota、入力長、count、レート制限を先に検証する。favorite/custom/private setの本文や過去カードはproviderへ渡さない。AI結果を保存するときはアカウント所有のprivate draftとして作成し、公開フラグを立てない。

### Provider呼び出しの推奨

OpenAI公式資料（2026-10-04確認）に基づき、低コスト・高頻度向けの現行モデルID `gpt-5.6-luna`、`POST https://api.openai.com/v1/responses`、Responses APIのStructured Outputsを使う。ResponsesではJSON schemaを`text.format`に置く。モデルはStructured Outputs対応で、`output_text`をJSON parseした後にもサーバー側の値検証を行う。

```js
const response = await client.responses.create({
  model: "gpt-5.6-luna",
  instructions: "日本語で、相互自己開示を促す独自の質問を作る。成人向け内容や危険行為を含めない。質問文だけを返す。",
  input: `テーマ: ${theme}\nトーン: ${tone ?? "自然であたたかい"}\n枚数: ${count}`,
  store: false,
  max_output_tokens: 1800,
  text: {
    format: {
      type: "json_schema",
      name: "mingle_questions",
      strict: true,
      schema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 60 },
          questions: {
            type: "array",
            minItems: 6,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                text: { type: "string", minLength: 1, maxLength: 240 },
                r18: { type: "boolean" }
              },
              required: ["text", "r18"],
              additionalProperties: false
            }
          }
        },
        required: ["name", "questions"],
        additionalProperties: false
      }
    }
  }
});
```

Schemaの配列上限は12にし、`questions.length === count`、重複、空白、文字数、`r18`、禁止内容をサーバーで再検証する。失敗したJSON、拒否、タイムアウト、quota超過は安全なHTTPエラーに変換し、providerの生レスポンスや秘密値をクライアントへ返さない。アプリ側の上限は`max_output_tokens: 1800`、provider呼び出しのtimeoutは20秒を目安に設定する。これらはAPIの最大値ではなく、この機能のコスト・待ち時間上限であり、実測に合わせて設定値化する。OpenAI側のGPT-5.6 Lunaの最大出力上限は128K tokensだが、この機能でそこまで許可しない。

## Phase 2（無料マーケットプレイス）

登録ユーザーは、完成`ready`セットについて、公開前に自分で名前、枚数、テーマ、対象年齢、説明、preview表示範囲を確認したうえで公開snapshotを出品できる。第三者によるKYCや本人確認は行わない。公開後のsnapshotは編集で書き換えず、更新は新しいversionとして扱う。出品停止（withdraw）後も、すでにimportされた利用者のcopyはその人のprivate setとして残る。新規importは停止する。出品者が元セットを削除しても、import済みcopyの所有者と内容は変えない。

マーケットプレイスの閲覧はmetadataと限定previewを中心にし、未見の質問本文を無条件に全公開しない。無料importは利用者自身のcopyを作り、My setsに追加する。出品者のfavoriteやprivate set、生成履歴は共有しない。価格、対象テーマ、出品数・quotaはこの設計では未決定であり、課金機能はphase 1に実装しない。

## Phase 3（entitlement）

| 区分 | 利用イメージ | 価格・数値quota |
| --- | --- | --- |
| ゲスト | 最初の6枚を遊ぶ。限定テーマ候補 | 未定 |
| 無料登録 | テーマ拡大候補、セット作成・保存、無料import | 未定 |
| 有料 | 広告なし、作成数・AI生成上限の拡大候補 | 未定 |
| 上位有料 | AI生成・公開などの上限拡大候補 | 未定 |

各区分の価格、対象テーマ、保存数・AI生成数などの数値quotaは未決定であり、表は候補比較に留める。Phase 1ではテーマ制限や決済を実装せず、課金、請求、entitlement enforcementも今回の実装範囲外である。既存のゲスト6枚→login継続体験を壊さず、サーバー認証とquotaの境界だけを先に設ける。

## 設計上の境界

- AIは新規質問の下書き専用で、本人のfavorite本文・既存カード本文・private set本文を入力に含めない。
- 生成結果はprivate draftとして保存し、本人の確認・編集・承認なしにPlayや公開へ進めない。
- セット削除は所有者のprivate setに限定し、phase 2のimport済みcopyを連鎖削除しない。
- SQL、外部設定、Push通知はこの概念設計の対象外。必要なruntime secretはサーバー専用の`OPENAI_API_KEY`だけとする。

## 公式資料

- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — Responses APIの`text.format`、`json_schema`、`strict`。
- [Text generation](https://developers.openai.com/api/docs/guides/text) — Responses API、`output_text`、本番でのsnapshot固定の考え方。
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) — `gpt-5.6-luna`の用途・API対応。価格や利用可能性はアカウントの契約・rate limitに依存する。
