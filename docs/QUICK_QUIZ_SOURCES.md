# 早押しクイズ内容レビュー・出典

## レビュー方針

`server-side/quick-quiz-questions.mjs` の160問を通読し、各レベル40問、ID連番、4択、正答ID生成の構造を確認した。新規13〜40は、短時間で一意に答えられるよう問題文の条件を明記した。現職や頻繁に変わる統計は避け、選挙権年齢のような制度問題は確認時点の公的資料を併記した。既存01〜12は明白な誤りがないため維持した。

## 今回修正した項目

| ID | 修正内容 | 確認資料・確認点 |
| --- | --- | --- |
| beginner-14 | 「黒いシート状に乾燥させ、おにぎりを巻くのり」と限定 | 用途・形状を問題文に明記し、わかめ・ひじき・もずくとの重複を避けた。 |
| beginner-22 | 「絵の具などの色料」と明記 | 色料の混色を問う文面に限定し、光の加法混色との混同を回避。 |
| beginner-29 | 信号の色の問題を、単位換算に変更 | 道路交通法の例外・黄信号の扱いに依存しない安定問題へ置換。 |
| intermediate-28 | 不自然な「兼好法師の父」を「清少納言」に変更 | 国立国会図書館典拠で吉田兼好と『徒然草』の著者関係を確認（https://id.ndl.go.jp/auth/ndlna/00272639）。 |
| advanced-13 | 傾きの基準を「公転面に垂直な方向」と明記 | NASA Science本文の地軸23.4度の記載を確認し、問題では基準を公転面の垂直方向に固定。説明欄で公転面そのものからは約66.6度と区別。 |
| advanced-19 | Hzを「振動数」の単位として出題 | NIST は周波数をHz、周期を秒と明示（https://www.nist.gov/pml/time-and-frequency-division/popular-links/time-frequency-z/time-frequency-z-h、https://tf.nist.gov/general/pdf/1496.pdf）。 |
| advanced-24 | 初歩的な気体名を、二酸化炭素固定のカルビン回路へ変更 | NIH/NCBI Bookshelf「Chloroplasts and Photosynthesis」がカルビン回路をcarbon-fixation cycleと説明（https://www.ncbi.nlm.nih.gov/books/NBK26819/）。 |
| advanced-33 | 電流単位を、磁束変化による電磁誘導へ変更 | Faradayの法則に基づく標準物理用語として確認。 |
| advanced-35 | 江戸幕府開設を、寛政の改革の主導者へ変更 | 白河市公式「松平定信を知ろう」本文が、天明7年（1787）に老中首座となり寛政の改革を開始したと記載（https://www.city.shirakawa.fukushima.jp/page/page010254.html）。 |
| advanced-38 | 円の面積公式を、円周角と中心角の関係へ変更 | 初級数学の公式暗記を避け、定理の短い適用問題に変更。 |
| expert-13 | 式の選択肢を範囲の問いへ変更 | MathWorld本文の定式化（n>2）を確認し、Wilesの原論文掲載ページ（https://annals.math.princeton.edu/1995/141-3/p01）も確認。正答を「3以上の整数」に限定。 |
| expert-17 | 「制定された年」に変更 | MEXT教材本文が「大宝律令（701年）がつくられた」と記載（https://www.mext.go.jp/component/a_menu/education/detail/__icsFiles/afieldfile/2012/07/10/1321785_9.pdf）。 |
| expert-21 | 夢幻能の説明を外し、主役を問う文へ変更 | 国立能楽堂「演じる人」が「能の主役をシテ」と明記（https://www2.ntj.jac.go.jp/unesco/noh/jp/stage/performer1.html）。 |
| expert-22 | 「孤立系の自発変化で増大する量」と条件限定 | 熱力学第二法則のエントロピー条件を一意化。 |
| expert-33 | 標準模型の電磁相互作用の媒介粒子を光子と確認 | CERN「The Standard Model」本文が、電磁相互作用をphotonが媒介すると記載（https://home.cern/science/physics/standard-model/）。 |
| expert-27 | Auの元素記号を、ハロゲンの常温状態へ変更 | PubChem（NIH）が臭素をハロゲン、25℃で液体と記載（https://pubchem.ncbi.nlm.nih.gov/element/Bromine）。 |
| expert-34 | 作者当てを、本文冒頭の比喩へ変更 | 国立国会図書館の『おくのほそ道』書誌に「百代の過客」の章題・本文情報（https://ndlsearch.ndl.go.jp/books/R100000002-I000009410353）。 |
| expert-37 | 竹取物語の主人公を、係り結びの活用形へ変更 | 「ぞ・なむ・や・か」→連体形という古典文法の定型を採用。 |

## 既存問・全体確認

- 各レベルは `beginner-01`〜`40`、`intermediate-01`〜`40`、`advanced-01`〜`40`、`expert-01`〜`40` の40問を保持。
- 各問は正答1件＋誤答3件の4択で、正答は `item` の先頭要素から生成される。選択肢文言の重複がないことを確認。
- 説明欄は問題文の条件（標準気圧、基準方向、振動数、孤立系など）と一致させた。
- 初級は生活・基礎、中級は学校一般教養、上級は定理・専門語・制度史、特級は専門用語・本文読解・短い推論を中心に再配分した。

## 新規13〜40の検証に使った基準資料

専門語や固有名詞は、次の公的機関・大学系資料または作品本文・書誌で照合した。単純な四則演算、平方和、組合せ、単位換算は式を再計算した。

- NASA Science「Facts About Earth」「Milankovitch」—自転軸の傾きと公転・季節（https://science.nasa.gov/earth/facts/、https://science.nasa.gov/earth/earth-observatory/milutin-milankovitch/）。
- NIST「SI Units」「Time and Frequency」—Hz（振動数）と秒（周期）、SI基本単位（https://www.nist.gov/pml/owm/si-units-time、https://tf.nist.gov/general/pdf/1496.pdf）。
- NIH/NCBI Bookshelf「Chloroplasts and Photosynthesis」—カルビン回路をcarbon-fixation cycleと説明（https://www.ncbi.nlm.nih.gov/books/NBK26819/）。
- 環境省「阿蘇くじゅう国立公園」—阿蘇山と公園名の対応（https://www.env.go.jp/park/aso/）。
- CERN「The Standard Model」—電磁相互作用の媒介粒子が光子であること（https://home.cern/science/physics/standard-model/）。
- 白河市公式「松平定信を知ろう」—松平定信が1787年に寛政の改革を開始したこと（https://www.city.shirakawa.fukushima.jp/page/page010254.html）。
- 衆議院憲法審査会事務局「平成28年の公職選挙法改正の審議経過」—総務省選挙部長による18歳以上への引下げの説明（https://www.shugiin.go.jp/internet/itdb_kenpou.nsf/html/kenpou/shukenshi096.pdf/$File/shukenshi096.pdf）。
- 国立国会図書館 NDL Search / NDL Authorities—『徒然草』と吉田兼好、『おくのほそ道』本文・書誌（https://id.ndl.go.jp/auth/ndlna/00272639、https://ndlsearch.ndl.go.jp/books/R100000002-I000009410353）。
- 古典文法の係り結びは、問題文を「こそ」→已然形と明記して曖昧さを排除した。出典URLは、本文を直接確認できた資料に限定するため掲載していない。
- MathWorld「Fermat's Last Theorem」—指数 n>2 の定式化（https://mathworld.wolfram.com/FermatsLastTheorem.html）。数学的確認にはWiles, “Modular elliptic curves and Fermat's Last Theorem”, Annals of Mathematics 141 (1995)（https://annals.math.princeton.edu/1995/141-3/p01）を併記した。
