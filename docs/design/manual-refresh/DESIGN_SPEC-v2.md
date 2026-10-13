# Mingle「わたしのトリセツ」刷新 v2 制作メモ

## 採用候補

- Board: [manual-ui-design-board-v2-final.png](./manual-ui-design-board-v2-final.png)
- 生成モード: `ui-mockup`（ImageGen built-in）。boardは実装用の視覚リファレンスで、画面を画像として製品に埋め込まない。
- 人物・顔・人体・服装・性別を連想させる表現はゼロ。カード、ページ、図形だけで構成する。
- 旧 `manual-ui-design-board-v1.png`、`manual-notebook-cards-hero-v1.png`、`manual-feeling-peel-motif-v1.png`、`manual-feeling-peel-motif-v2.png` は不採用ドラフト。production UIから参照しない。既存ファイルは削除しない。

## ブランド基準

`wt-torisetsu3/dist/assets` の公式Mingle画像（`mingle-og.png`、`mingle-cards-masthead.png`、`minglecard-masthead-v2.png`）を参照した。基準は、鮮やかなblue/coral、deep navyの明瞭な輪郭、yellowの少量アクセント、creamの余白、現代的で端正なフラットグラフィック。水彩、ちぎり紙、昭和ポスター、手書き文字、甘いキャラクター、花、ハート、巨大な影、gradient、pillの壁は使用しない。

## 実装spec

- live productの実フローは5 stepsを維持する。ラベルは `予想 / 思い出す / 並べる / 見つける / ためす`。boardは3画面の代表例だが、3 steps仕様へ変更しない。
- mobile-first。cream `#FFF9F0`、navy `#102A63`、blue `#1468E8`、coral `#FF6258`、yellow `#F6C846`、pale blue `#EAF0FF`。
- 見出しは読みやすい日本語sans-serif、body相当16px以上。outlineはnavy、影は原則なし。
- 深い気持ち画面は2列タイル。選択状態はblue面＋coralの小さなマーカー。タイルをpill形状にしない。
- 発見結果は短い要点を先に置き、`根拠になった答え` のdetailsを2〜3行で続ける。
- 完成トリセツは縦書類構造。既存の全章・全セクションを保持し、重要な要点とvoice返信を見せる。トップのgraphic accentは小さなカード重なり、または本の線画。
- 操作アイコンは既存native/UIコードで実装。画像生成素材には文字・ボタン・logoを焼き込まない。

## board v2 最終prompt全文

```text
Use case: ui-mockup
Asset type: mobile-first UI design board for Mingle’s Japanese “わたしのトリセツ” flow
Primary request: Create one polished design board showing three separate implementation-ready mobile screens side by side: (1) deep feelings selection, (2) findings/result, (3) completed personal manual. The real product has five steps; show a clear five-step progress rail at the top of every screen with labels “予想 / 思い出す / 並べる / 見つける / ためす”, with the current step highlighted.
Brand references: Mingle’s existing visual language is vivid blue and coral overlapping rounded cards with dark navy outlines and small yellow accent rays, on a warm cream canvas. Use this as a brand reference only; do not reproduce the official logo.
Scene/backdrop: clean warm cream canvas, three narrow phone frames, generous spacing.
Subject: modern self-understanding tool with concise Japanese copy and highly scannable layouts.
Style/medium: contemporary editorial product UI with crisp vector-like graphics, precise dark navy outlines, restrained flat color blocks, accessible Japanese sans-serif typography. Modern, confident, slightly playful, no nostalgia.
Composition/framing: portrait board; each screen is a realistic 390px mobile layout. Screen 1 uses a compact two-column tile grid for feelings, with one selected tile in vivid blue and a coral edge marker. Screen 2 shows one key finding as a large concise statement, followed by a “根拠になった答え” details section with 2–3 compact rows. Screen 3 shows the manual as a clean vertical document with two highlighted takeaways and one clear CTA. Add only one small graphic accent near each header: overlapping blue/coral cards or a minimal outlined book symbol.
Lighting/mood: flat graphic presentation, no shadows, no glow, calm and focused.
Color palette: cream #FFF9F0, deep navy #102A63, vivid blue #1468E8, coral #FF6258, sunny yellow #F6C846, cool pale blue #EAF0FF.
Typography: Japanese sans-serif, high contrast, compact but readable, 16px minimum body equivalent.
Text (verbatim): Screen 1 heading “その気持ち、もう少し奥には？”; tiles “不安・こわかった”, “さびしかった”, “大切にされていない感じ”, “置いていかれた感じ”, “悲しかった”, “くやしかった”. Screen 2 heading “見つけたこと”; key statement “表の気持ちの奥に、不安がありました”; details label “根拠になった答え”. Screen 3 heading “わたしのトリセツ”; takeaways “しんどいときは、まず話を聞いてほしい”, “かけてほしい言葉：よくやってるよ”. Keep copy short and accurately rendered.
Constraints: no gradients, no glassmorphism, no watercolor, no torn paper, no handwritten lettering, no retro Showa poster style, no smiling female character, no flowers, no hearts, no therapeutic worksheet look, no large shadows, no pill-button wall, no official logo, no watermark. The UI must look implementable in HTML/CSS and preserve five-step product logic.
```

## board v2 人物ゼロ編集prompt全文

```text
Edit this exact mobile UI design board while preserving the three-screen layout, typography, Japanese copy, five-step progress rail, colors, spacing, and crisp modern Mingle visual language. Remove every human-related pictogram or body reference. In particular, replace the yellow circular icon in the third “根拠になった答え” row (currently a group-of-people symbol) with a purely abstract geometric symbol such as three offset navy/yellow squares or a small outlined card stack. Also inspect the full board and ensure there are zero people, faces, heads, bodies, silhouettes, gender cues, clothing cues, flowers, hearts, or character illustrations anywhere. Keep the small blue/coral card accents and outlined book symbol as non-human graphic motifs. Preserve cream canvas, vivid blue, coral, navy and yellow, sharp outlines, flat graphic treatment, no gradients, no glow, no large shadows, no watercolor, no handwritten text, no retro/showa style, and no watermark. This is a UI reference board; do not add new text or alter the existing Japanese copy.
```

## 次工程

board v2採用済み。下記の個別パーツ2点を採用候補としてdistへ保存済み。



## 実装時の追加注記

- 完成トリセツ画面はboardの代表例に合わせて内容を削らない。既存の全章・全セクションを保持し、重要な要点とvoice返信を視認できる構成にする。
- voice章を含む5ステップの既存ラベルは、実装で一律にboard文言へ置換しない。現行機能・章ラベルを保持し、boardの5ステップ表記は構造の参照として扱う。

## 個別パーツ採用

- 採用: `dist/assets/manual-refresh/manual-discovery-cards-v3-neutral.png` — 思い出す/見つける用の横長headerアクセント。ImageGen built-in、transparent background、人物/顔/身体/性別示唆/文字ゼロ。
- 採用: `dist/assets/manual-refresh/manual-open-book-cards-v3-neutral.png` — 完成manual用の本＋カードアクセント。最終生成はflat cleanupをImageGenで実施。transparent background、人物/顔/身体/性別示唆/文字/halo/glowゼロ。
- 旧版個別素材は不採用ドラフト。task-ownedの旧dist素材は製品配布に残さず、`docs/design/manual-refresh/drafts`へ移す対象として親/UI担当へ報告する。ユーザー提供ファイルは削除しない。

## 個別パーツ prompt全文

### manual-discovery-cards-v3-neutral.png

```text
Use case: production UI decorative asset. Create a compact horizontal abstract graphic accent for Mingle’s Japanese “わたしのトリセツ” mobile UI, used near the 思い出す / 見つける steps. Show two or three overlapping rectangular cards with crisp deep navy outlines, one vivid blue card and one coral card, plus a tiny geometric discovery mark made only from a navy square, blue line, or small yellow ray. Modern editorial vector-like flat graphic, precise clean edges, restrained composition, generous transparent padding. Absolutely zero text, letters, numbers, logos, icons resembling people, faces, heads, bodies, silhouettes, clothing, gender cues, flowers, hearts, hands, mascots, or characters. No watercolor, torn paper, retro Showa style, handwriting, therapy worksheet, gradient, glow, halo, drop shadow, or texture. Transparent background outside the flat card shapes. Palette: deep navy #102A63, vivid blue #1468E8, coral #FF6258, small sunny yellow #F6C846. Compact wide aspect ratio, implementation-ready PNG asset, no watermark.
```

### manual-open-book-cards-v3-neutral.png（最終採用call）

```text
A flat vector UI icon only, isolated on a truly transparent background: a simple open book made of two white pages with a hard-edged deep navy outline, one flat vivid blue rectangular card behind the left page and one flat coral rectangular card behind the right page, plus three tiny flat sunny yellow rectangular rays at upper left. Crisp geometric shapes, solid fills, clean sharp edges, compact near-square composition. No lighting effects of any kind: absolutely no glow, no halo, no bloom, no vignette, no shadow, no gradient, no blur, no ambient aura, no texture. Outside every navy outline is fully transparent. No text, letters, numbers, logo, person, face, head, body, silhouette, clothing, gender cue, hand, flower, heart, mascot, or character. Modern Mingle blue/coral/navy/yellow palette, implementation-ready PNG, no watermark.
```

### book flat cleanup/edit attempts

```text
Strict flat-asset cleanup. Re-render this asset as a simple flat SVG-like icon on transparency. Keep the same open book and adjacent blue/coral cards, but remove every pixel of soft blur, bloom, halo, illumination, aura, vignette, gradient, and shadow. The only dark navy may be a hard-edged 6–10px outline immediately touching the book/cards; outside that outline must be fully transparent. Yellow rays must be hard-edged flat rectangles with no glow. Use solid fills only: white page, #1468E8 blue, #FF6258 coral, #102A63 navy outline, #F6C846 yellow. Preserve zero text and zero human or gender-related forms. No background color, no watermark.
```
