# 中國象棋 · Chinese Chess V2

有水準、有難度的中國象棋（Xiangqi）網頁版：真實規則、木質棋盤、
**Pikafish**（最强開源中國象棋引擎）跑在 WebAssembly 裏面，
**唔需要任何 server，離線都可以玩**。

## 三種開法（全部免費、全部離線可用）

| 方法 | 點做 | 適用 |
|---|---|---|
| **1. 直接雙擊** `index.html` | 用瀏覽器打開就得（`file://`） | Mac / 任何電腦 |
| **2. GitHub 連結** | 上载全部檔案 → 開 Pages → 用連結喺 Safari 打開 → 「加入主畫面」 | iPhone（你而家嘅流程） |
| 3. `python3 serve.py` | 只係用於同一 Wi-Fi 俾部手機即時試 | 可選，唔再需要 |

> 以前版本一定要 server 先有專業引擎；而家 `assets-embedded.js` 把整個
> 引擎（連 50MB 評測網絡）base64 嵌入咗成一個 JS 檔案，`<script>` 标签
> 喺 `file://` 下面都載入得到，所以**雙擊即玩專業引擎**。
>
> **狀態顯示（隨時知道引擎係乜狀態）：**
> * 頂欄徽章：**⚡ 轉圈 + 階段**（下載中 42% / 解碼中 / 編譯中 / 載入網）→
>   就緒後變綠點 **⚡ Pikafish**（懸停可睇詳情）；失敗顯示 **⚠ JS備用**。
> * **AI 思考條**：AI 思考時喺頂欄下方懸浮出一條金色動畫（淡入淡出，**唔佔版面**，棋盤完全唔會上下移動），**實時**顯示引擎
>   深度 / 分數 / 搜索速度(N/s) / 已用時間（引擎 info 行即時串流），
>   評估條都會跟住引擎分數即時變動；黑方取子盤仲有「思考中…」標記。
> * 分頁標題同步顯示狀態（⚡Pikafish✅ / ⚠JS備用），切咗背景都會知道。

## 專案檔案

```
index.html             遊戲 + UI（入面有 #autotest 自動測試 hook）
engine.js              純 JS 引擎（規則 / 落子 / 搜索）— 備用引擎
engine-wasm.js         Pikafish worker 橋
wasm/pikafish-single.js / .wasm   Emscripten 編譯嘅 Pikafish（~0.6MB）
wasm/pikafish.nnue     官方 NNUE 網絡（50MB）
assets-embedded.js     上面四個嘅 base64 合集（~67MB，generated）
sw.js                  Service Worker（離線 PWA，v7/b10）
serve.py               本地 LAN server（可選）
build-wasm.sh          重新編譯 Pikafish → wasm/
build-assets.py        重新打包 assets-embedded.js
test-engine.js         node test-engine.js（規則/引擎測試）
```

## 更新引擎嘅流程

```sh
./build-wasm.sh          # 1. 重新編譯 Pikafish（需要 emscripten）
python3 build-assets.py  # 2. 重新生成 assets-embedded.js
```

然後照舊**上载全部檔案到 GitHub**（記得包含 `assets-embedded.js` 同
`wasm/pikafish.nnue`，兩個都係引擎必需）。改咗任何代碼後：

* iPhone 用戶：重新打開一次你嘅 Pages 連結（有網絡時），Service Worker
  會自動更新並重新快取；之後離線照常玩。
* 想即刻驗證部署成功：用瀏覽器開 `你的Pages連結/#autotest`，
  見到綠底 **AUTOTEST PASS** 就代表專業引擎完整就緒。

## 備忘錄

* 雙擊 `index.html`（file://）：JS 引擎 worker 由頁面自身代碼建立，
  WASM 由 `assets-embedded.js` 解碼 — 全部離線、零請求。
* GitHub Pages 版：優先 fetch 50MB 二進制網絡；萬一嗰個檔案喺 GitHub
  上面壞咗（例如變成 Git-LFS pointer），會自動改用內嵌副本。
* `assets-embedded.js` 係 generated file — 唔好手改；唔好放進 editor。
* 引擎時間已實測準確：設 100ms / 1s / 5s 就實打實諗咁耐（毫秒級吻合），
  進度行（info）完整收到；技術細節睇 `wasm/README-wasm.md`。

## iOS 主畫面 App 白色底邊（2026-10-27 修復，v8/b11）

* iPhone「加入主畫面」安裝嘅 web app 有 WebKit bug（[#254868](https://bugs.webkit.org/show_bug.cgi?id=254868)）：
  `height:100%` / `100svh` / `100dvh` / `visualViewport.height` 全部會扣走
  下方 home indicator 安全區（約 34pt），而 `100vh` 唔會扣 — 所以 app 底部
  露出一條 webview 白色底邊（Android 同普通 Safari 冇呢個問題）。
* 修復（`index.html`，三層保險）：
  1. shell 改用 `min-height:100vh`（standalone 下 = 全螢幕）— WebKit 會將
     layout viewport 伸到全 window（bug [#210009](https://bugs.webkit.org/show_bug.cgi?id=210009)），
     背景畫入底邊；`#app`（fixed inset:0）跟住變高 → 棋盤自動用返嗰 34pt
     （棋盤微度變大 = 真正「最大化」）。
  2. `bleedFix()`：standalone 下若 `screen.height − innerHeight` 係 1–150pt
     嘅 gap，就用 px 伸返 html/body 做雙保險。
  3. `#bleed`：一圈 overflow 出 layout viewport 嘅深色邊環，邊度有白邊
     就覆蓋邊度；正常環境（desktop / Android / 普通 Safari）完全 off-screen，
     零影響。
* 驗證：開 menu →「離線快取」顯示 `2026-10-27-b11` 即新代碼落地；底邊變深、
  棋盤變大即成功。萬一極少數機型仍有白邊：長按刪除主畫面圖標 → Safari
  重開連結 → 重新「加入主畫面」（manifest 深色 `background_color` 會喺
  安裝時生效）。

## Cloudflare Pages 部署（2026-10-27 加入）

**官方公開連結**：`https://chinese-chess-8ca.pages.dev`（QR code 由此產生；
GitHub Pages 連結照舊運作，兩者內容一致）。

* Cloudflare 有**每個檔案 25 MiB** 上限，而 `wasm/pikafish.nnue` 係 47.7 MiB、
  `assets-embedded.js` 係 64.4 MiB — 兩者都唔俾直接上载。
* 解法（**遊戲代碼零改動**）：
  * `wasm/pikafish.nnue.part-1…3`（每份 ≤19 MiB）+ `wasm/pikafish.nnue.parts`
    （寫住份數 `3`）——build 時隨倉部署。
  * `functions/wasm/pikafish.nnue.js`（Cloudflare Pages Function）：將 parts
    串流拼返做同一個 `wasm/pikafish.nnue` 回應（Content-Length 正確，
    下載進度條正常；service worker 照常 cache-first 快取整份）。
  * Pages build 用 `tar` 將可發佈內容複製去 `dist/`（排除兩個超標大檔
    同 `.git`），output directory = `dist`。兩個大檔**照留喺 repo**，
    所以 GitHub Pages 連結完全不受影響。
* **更新流程**：改代碼 → commit → push 到 `main` → Cloudflare 自動
  重新部署（免費方案每月 500 builds）。
* **離線（2026-10-27 v6 修復）**：Cloudflare function 用 `no-store`
  （防止 CDN 釘死舊引擎位），但 Cache API 會靜默拒收 no-store 回應，
  50MB 網絡原本永遠入唔到 service worker cache → 離線/重開 App 玩唔到
  Pikafish。而家 `sw.js` 會喺寫 cache 前 strip 掉 `no-store`（返返 app
  嗰份唔變），另外 cache miss 會先嘗試網絡先至回落 503（fresh install
  首次下載）。**首次要有網絡**（下載 50MB），之後飛機模式照玩；
  未下載完就離線 → 自動用 ⚠ JS 備用引擎。
* **離線第二層（2026-10-27，`_headers` 檔）**：Cloudflare CDN 預設
  `max-age=0, must-revalidate` — 離線時 HTTP cache 唔准返舊副本，而 iOS
  Safari 開新 tab 嗰次導航根本唔會交俾 service worker，所以直接彈
  「未連接互聯網」錯誤。而家 `_headers` 為 shell 檔案（`/`、`sw.js`、
  引擎、icons、manifest）設 `max-age=0` + `stale-if-error`：
  在線行為唔變（每次重新驗證、更新即時落地），離線時 HTTP cache 會返返
  上次嗰份；頁面載入後由 service worker（v7）接管其餘全部資源。
  有意**唔加** `stale-while-revalidate` 喺 shell/代碼檔（會令在線用戶收到舊代碼）；
  `/sw.js` 特別用 `no-store` — SW 腳本必須永遠係最新位元組，否則瀏覽器嘅
  SW 更新檢查會收到舊版本 → 手機永遠卡喺舊離線層（2026-10-27 實測根因）。
  （`/wasm/pikafish.nnue*` 故意唔加 — function 自己有 cache policy）
* **menu 新增**：「AI 引擎」狀態行（顯示失敗原因）+「重建離線快取」掣
  （清除 service worker + caches + IndexedDB 後重新載入 — 手機卡喺舊 SW 時
  用呢個復原）。
* **離線第三層（2026-10-27 v7，三重保障）**：iPhone 實測發現 50MB 網絡
  入唔住 service worker cache（v6 寫 cache 時抹走咗 `Cache-Control`，
  WebKit 會將無 lifetime 嘅 entry 當 best-effort 很快淘汰）。而家：
  1. `sw.js`（v7）寫 cache 一律用 `max-age=31536000, immutable`
    （所有 asset 都係 content-immutable；freshness 靠 cache 名 bump 控制）；
     大檔下載去重（一次 load 只下載一次 50MB）；Cloudflare 對唔存在嘅
     路返 200 index.html（例如 `assets-embedded.js`）嘅垃圾 entry 唔會再
     被 cache / 服務；cache 名 bump 時會先由舊 backup cache 搬大檔（唔使
     重新下載 50MB），新 cache 完整後先刪除 backup。
  2. Cloudflare function 改用 `max-age=0, stale-while-revalidate, stale-if-error`
     （在線每次重新驗證→引擎更新即時落地；離線時 browser HTTP cache 可以
     返舊 50MB — 專治 SW 唔攞住嗰啲 request）。
  3. app 下載成功後會 mirror 50MB 網絡入 **IndexedDB**（`index.html` 嘅
     `idbPutNet`）— iOS 上 IndexedDB 比 SW Cache API 持久得多；離線時 web
     fetch 失敗會自動改用 IDB 份（`idbParts`）。引擎重新編譯後要 bump
     `NET_KEY`（`pikafish.nnue-v1` → `v2`…），舊 blob 會自動清走。
* **iOS 注意**：Safari tab 喺離線狀態開新導航會被 iOS 系統層直接彈
  「未連接互聯網」（service worker / HTTP cache 都救唔到）— 離線請用
  **桌面 icon**（standalone 模式）。
* **重新編譯引擎後**（`./build-wasm.sh`）：除咗照舊做 `build-assets.py`，
  仲要重新拆 parts + 更新份數檔：
  ```sh
  cd wasm && rm -f pikafish.nnue.part-* && split -b 20000000 pikafish.nnue pikafish.nnue.part- && i=1; for f in pikafish.nnue.part-*; do mv "$f" "pikafish.nnue.part-$i"; i=$((i+1)); done; printf '%s' $(ls pikafish.nnue.part-[0-9]* | wc -l) > pikafish.nnue.parts
  ```
  然後 commit + push（记得連 parts 一起 commit）。

<!-- webhook test 20261027 -->
