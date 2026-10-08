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

## 販売・作者収益化の将来検討メモ（2026-10-08時点、現在未適用）

### 現在の扱いと合意事項

- 販売、課金、作者への収益分配は後回しとし、現時点では決済を実装しない。既存の無料Marketplaceの公開・importは維持する。公開版の価格表やentitlementは変更しない。
- 以下は実装再開時に再検討する方針、候補、未決事項を整理したメモであり、確定仕様や効果の実証結果ではない。既存の無料Marketplace仕様を置き換えない。
- Plusは月300円／年3,000円がユーザー案、Premiumは月490円がユーザー案である。Premium年4,900円はassistant案であり未承認。金額は将来変更され得るため、公開価格表として扱わない。

### 価格・公開範囲の仮説

旧案の「Marketplaceの利用・購入にはPremium必須」から、購入者はFreeでも商品代金を支払えば購入できる方向を検討する。Guest購入は、メール検証、アカウントへの安全な紐付け、購入権の復元を含めて候補だが未決定とする。無料公開はFreeまたは低価格プランへ開放する案を比較する。

ユーザー中心の仮説として、Free作者が収益を受け取れなくても、無料公開でいいね、実際に遊ばれた回数、最近の利用を得て需要を確かめられれば、Premiumへ追加投資して有料販売を試したくなる可能性がある。Premiumで有料販売を解放する案は有力候補だが、仕様確定でも効果実証でもない。

作者には、いいね、実際に遊ばれた回数、最近の利用などの基本利用実績をFreeでも見せ、収益化判断の根拠にする案がある。会話の回答内容、音声、非公開メモは保存せず、集計イベントで足りる設計を優先する。無料利用は支払意思を意味しないため、Premium転換だけでなく、初売上、作者手取り、継続利用も検証対象とする。無料作者にも参加価値を残す。

### 枚数・無料previewの未決定案

「無料だと6枚まで、有料にするには最低20枚セット」は、無料公開セットの上限を6枚とする案として解釈したが、制限の対象範囲も含めて未確定である。代替案として、無料公開セット自体に6枚上限を設けず、6枚を試作・体験版の目安とし、有料セットは当初20枚以上、作者が選ぶ6枚を無料試遊にして購入後に全20枚以上を解放する案がある。制作・編集は無料で完了でき、販売公開時にPremium加入を求める構成も候補である。

無料6枚上限には、無料で20枚公開したい作者の制限と、7～19枚セットの扱いという論点がある。有料20枚以上には、枚数の水増しや短い高品質作品の排除という論点がある。6枚／20枚の最適性は未検証である。有料版の追加価値は枚数だけでなく、テーマ、用途、構成も含めて検討する。Guestの公式テーマにある既存の6枚制限とは別ルールであり、混同しない。

### 作者料金と手数料の比較

作者に月額を必須とする案と、売上連動手数料を基本にしてPremiumへ任意加入した作者を優遇する案を比較する。初売上前の確定費用は参入障壁になり得るが、無料公開で需要を確認してから加入できれば緩和できる可能性がある。販売手数料の有無・率、価格設定者、税負担、支払周期、留保、返金・chargeback責任は未決定とする。

手数料率の例（20%／10%）や、月売上4,900円に対する手数料率差10ポイント＝490円、500円テーマの例は説明用の仮定であり、仕様の数値として採用しない。作者月額490円、商品代金、決済・送金費、Mingleの取り分は別の費目として比較する。

### 決済・権利付与の候補フロー

将来候補は、単発テーマ購入とPremium継続課金を分離したStripe Checkout、および作者本人確認・銀行口座登録をStripe hosted onboardingで扱うStripe Connectである。Mingleが身分証やカード番号を保持しない構成を前提候補とする。

サーバーが価格、作者、売上配分を確定してCheckoutへ進め、署名検証済みWebhookで支払成功を確認する。成功ページへの到達だけで購入確定にしてはならない。Webhook処理では冪等な注文、購入権、売上台帳を更新し、その後に購入者へ全文を解放する。購入前に全文を配布してCSS/JSだけで隠す方式は採用しない。

公開previewと、購入権を持つ利用者向け全文をAPI/RPCで分離する。現在の無料Marketplaceのimportも、購入条件を導入する場合は直RPCを含めて条件を適用する。商品versionと購入時の条件を保存する。Stripe残高へのTransferと銀行へのPayoutは別段階であり、同一扱いにしない。1購入＝1作者＝1セット、日本国内JPYを初期候補とするが、Direct charges、Destination charges、Separate charges and transfers、販売主体、返金・chargeback責任は未決定である。

返金時は注文、購入権、売上台帳を連動させ、必要ならtransfer reversalなどを扱う。すでに作者へ配分済みの売上が返金で自動復元されるとは決めつけない。Premium解約で、既存購入者の利用権や作者にすでに帰属した売上を没収しない案を基本にする。新規有料販売を停止する時点、既存出品の継続、購入versionの更新、返金後の私的コピーの扱いは要決定とする。

### データ・運用の提案

実装再開時の候補データは `orders`、`entitlements`、`creator_accounts`、`stripe_events`、`revenue_ledger`、`transfers`、`payouts` である。`transfers`と`payouts`は別概念として記録する。Guest購入ではメール確認、アカウントへの安全な紐付け、購入権復元を設計する。出品者の本人確認未完了、入金失敗も利用者に分かる状態で表示する。

編集やリミックスを許可しても、再公開・再販売まで許可されるとは限らない。原作者の許諾を分けて扱う。「変える」は「買える」の意味だった可能性もあるため、ここでは購入を前提に整理し、編集機能の確定仕様とはしない。

### 費用の参考（再確認前提）

2026-10-08に確認したStripe Connectの費用は契約モデルで異なる。プラットフォームが料金を管理するモデルでは、銀行・デビットへ入金のあったactive作者accountに月200円、payoutごと0.25%＋250円という説明があり、別モデルでは同じConnect追加料でない。標準カード決済3.6%も別にかかる。国、契約、対応周期に依存するため、実装再開時に再確認する。少額商品の毎回銀行送金には注意し、具体的な周期、留保、費用負担は未決定とする。「任意の最低額に達するまで無期限保留」を保証しない。

### 参照資料

- [Stripe Checkout fulfillment](https://docs.stripe.com/payments/checkout/fulfillment)
- [Stripe Connect payment acceptance](https://docs.stripe.com/connect/enable-payment-acceptance-guide)
- [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Stripe Connect pricing](https://stripe.com/jp/connect/pricing)
- [Stripe pricing](https://stripe.com/jp/pricing)
- 比較参考：[Gumroad pricing](https://gumroad.com/pricing)、[Ko-fi pricing](https://ko-fi.com/home/pricing)
- 心理研究は仮説の検討材料に留め、この料金体系や6枚／20枚の最適性を証明するものとは扱わない：ゼロ価格効果（[研究](https://doi.org/10.1287/mksc.1060.0254)）、外的報酬と内発的動機（[研究](https://doi.org/10.1037/0033-2909.125.6.627)）、プロスペクト理論（[研究](https://doi.org/10.2307/1914185)）、目標勾配（[研究](https://doi.org/10.1509/jmkr.43.1.39)）。

## 設計上の境界

- AIは新規質問の下書き専用で、本人のfavorite本文・既存カード本文・private set本文を入力に含めない。
- 生成結果はprivate draftとして保存し、本人の確認・編集・承認なしにPlayや公開へ進めない。
- セット削除は所有者のprivate setに限定し、phase 2のimport済みcopyを連鎖削除しない。
- SQL、外部設定、Push通知はこの概念設計の対象外。必要なruntime secretはサーバー専用の`OPENAI_API_KEY`だけとする。

## 公式資料

- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — Responses APIの`text.format`、`json_schema`、`strict`。
- [Text generation](https://developers.openai.com/api/docs/guides/text) — Responses API、`output_text`、本番でのsnapshot固定の考え方。
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) — `gpt-5.6-luna`の用途・API対応。価格や利用可能性はアカウントの契約・rate limitに依存する。
