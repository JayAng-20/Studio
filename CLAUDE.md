# JayAng Studio Web

檔案不上傳，全部在你的瀏覽器裡完成：七個媒體工具的純前端網站（React 19＋Vite＋TS），部署在 GitHub Pages。
**完整規格以 `BUILD_SPEC.md` 為準**，每次開工先讀完它與本檔。

## 常用指令

```bash
npm run dev          # 開發伺服器
npm run build        # tsc -b && vite build（輸出 dist/）
npm run preview      # 預覽 build 結果
npm run typecheck    # 型別檢查
npm run lint         # ESLint
npm run test         # Vitest（tests/**/*.test.ts(x)）
npm run test:e2e     # Playwright 截圖（需先 build；輸出 docs/screenshots/）
npm run check:size   # 首頁 JS 大小（超過預算只警告）
node scripts/gen-third-party.mjs  # 更新第三方授權清單
node scripts/gen-icons.mjs        # 由 favicon.svg 產生 PNG 圖示
```

每個階段結束的關卡：`npm run typecheck && npm run lint && npm run test && npm run build` 全過。

## 目錄

```
src/app/            外殼：Shell、Sidebar、TopBar、MobileTabBar、TaskCenter、CommandPalette、pages/
src/config/         app.ts（名稱版本連結）、modules.ts（七模組定義與懶載入）、thirdParty.json
src/design/         tokens.css、motion.ts、Logo、ModuleGlyphs、Ambient、illustrations
src/components/ui/  共用元件（Button、Dialog、DropZone、SortableList…，從 index.ts 匯入）
src/components/layout/ ModulePage、Workspace、TopBarActions、ErrorBoundary
src/features/<id>/  各模組：index.tsx（預設匯出頁面）、i18n.ts（zh／en 字串）；doc2pdf 由 PDF 工具載入
src/stores/         settings、tasks（runTask／useTask）、fileBus、recents、ui
src/lib/            format、filename、download、zip、image、files、capabilities、storage
src/workers/        Worker
tests/              Vitest
```

## 鐵則

1. **執行階段不連任何外部網域**：字型、WASM、Worker 一律 npm 安裝並打包（`?url`／`new URL(..., import.meta.url)`）。
2. **字串不寫死**：共用字串在 `src/i18n/zh-TW.ts`＋`en.ts`；模組字串在 `features/<id>/i18n.ts`（`zh` 與 `en`，型別強制鍵一致）。用 `useT()`。
3. **台灣用語**、全形標點、用「你」、按鈕動詞開頭。
4. **動畫只用 `design/motion.ts` 的 token**（duration／easing／spring／stagger），只動 transform／opacity。動畫強度由 `<html data-motion>` 與 `MotionConfig` 統一控制。
5. **顏色只用 token**（`bg-surface`、`text-text-2`、`text-accent-ink`、`bg-accent-strong`…），模組色由 `<html data-module>` 切換。
6. **不做空殼**：看得到的按鈕都要能用；做不到的從介面移除並寫進 README「尚未支援」。
7. 長時間作業走 `useTask()`（進度、取消、錯誤、結果）；模組間傳檔走 `fileBus`。
8. 錯誤訊息說明「發生什麼事」與「可以怎麼辦」；原始例外只 `console.error`。
9. 物件 URL、ImageBitmap、canvas 用完就釋放。
10. 不推 `main`、不 force push；commit 訊息 `類型(範圍): 說明`（繁體中文）。

## 目前進度

- 已完成：Phase 0–5。七個模組（播放器、錄影、GIF、圖片互轉、圖片工具、QR、PDF）＋文字轉 PDF（在 PDF 工具內）全部 P0／P1 完成，P2 大部分完成。
- 部署：GitHub Pages（`deploy.yml` 在 main 與工作分支推送時發布）。
- 未完成／不做：OCR、PDF 加密（原因見 README「尚未支援」）。
- 已知問題與未驗證項目：見 `docs/ACCEPTANCE.md`（實體裝置、Safari、Firefox 未測）。
