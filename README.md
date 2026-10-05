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
sw.js                  Service Worker（離線 PWA，b3）
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
