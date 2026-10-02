# JayAng Studio Web

**檔案不上傳，全部在你的瀏覽器裡完成。**

macOS App「JayAng Studio」的網頁精選版：七個媒體工具，加上文字轉 PDF，全部在本機處理，不用註冊、沒有追蹤，可以安裝成 App 離線使用。

網站：<https://jayang-20.github.io/Studio/>

![首頁（淺色）](docs/screenshots/home-light-1440.png)

## 功能

| 工具 | 重點功能 |
|---|---|
| **媒體播放器** | 播放清單、自製玻璃控制列、音量到 200%、0.25–4 倍速、±5／±10 秒、逐格、截圖、PiP、A–B 區間循環與匯出、SRT／VTT 字幕（自動判斷 Big5）、頻譜、記住播放進度、5 段等化器、HLS 網址 |
| **螢幕錄影** | 整個畫面／視窗／分頁、系統音訊＋麥克風混音、3‑2‑1 倒數、錄製中浮動控制列、鏡頭泡泡、時間標記、錄影庫、裁切與轉 MP4；iOS 改用鏡頭錄影 |
| **GIF 製作** | 影片或多張圖片、縮圖膠卷時間軸、即時大小預估、抖色、影格編輯、文字、裁切、綠幕去背、輸出 GIF／APNG／WebP 動畫 |
| **圖片互轉** | JPG、PNG、WebP、AVIF、HEIC、SVG、BMP、GIF 互轉，ICO 多尺寸、EXIF 保留或移除、目標檔案大小、進階編碼器、批次與 ZIP、動畫逐格轉換 |
| **圖片工具** | 裁切縮放與拉直、濾鏡、浮水印、遮蔽、壓縮與前後對比、EXIF 檢視與「只移除位置」、取色、拼貼、100 步復原 |
| **QR Code** | 9 種內容（網址、Wi‑Fi、聯絡人、行事曆…）、漸層與樣式、中央 Logo、相機與圖片掃描、批次產生、範本 |
| **PDF 工具** | 檢視、合併、分割、整理頁面、圖片轉 PDF、**文字轉 PDF**、PDF 轉圖片與**長截圖**、浮水印與頁碼（支援中文）、擷取文字、文件資訊、掃描式壓縮、移除密碼、填寫表單、標註與簽名 |

**文字轉 PDF**：md、txt、rtf 轉成文字可選取的 PDF，保留標題、表格、清單、程式碼等格式，自動產生有頁碼與連結的目錄，以及 PDF 書籤；三套排版主題。

**共用**：指令面板（⌘K／Ctrl+K）、任務中心、模組間「傳送到…」、首頁拖放自動建議工具、深淺色與動畫強度設定、繁體中文／English、鍵盤快捷鍵（按 `?`）。

## 隱私

- 所有檔案都在你的瀏覽器裡處理，**不會上傳**到任何伺服器。
- 沒有統計、追蹤或遙測；執行時不連任何第三方網站（字型、WASM、Worker 都打包在本站）。
- 存在本機的資料：設定、最近使用（只有檔名）、錄影庫、播放進度、QR 掃描歷史與範本、各工具的偏好設定。可在「設定 → 資料」清除。

## 瀏覽器支援

| 瀏覽器 | 支援程度 |
|---|---|
| Chrome／Edge（最新兩版） | 完整功能 |
| Safari 16.4 以上 | 可用；不支援的能力會停用並說明（例如螢幕錄影在 iOS 改用鏡頭錄影、APNG／動態 WebP 只轉第一格） |
| Firefox（最新版） | 可用；同上 |

## 尚未支援

- OCR 文字辨識（需要在執行時下載語言資料，違反不外連的原則）
- 為 PDF 加上密碼（瀏覽器端沒有可靠的加密寫入方式）
- 文字轉 PDF：數學公式、註腳、程式碼語法上色；斜體為模擬；RTF 合併儲存格與巢狀表格
- 沒有 ImageDecoder 的瀏覽器（例如 Safari）上，APNG 與動態 WebP 只能轉第一格；動畫不支援目標檔案大小
- Chrome 目前不支援把動畫 GIF 複製到剪貼簿（按鈕會停用並說明）

## 技術棧

Vite＋React 19＋TypeScript（strict）、Tailwind CSS v4＋CSS 變數設計 token、motion、Radix UI、cmdk、vaul、sonner、Zustand、idb-keyval、@dnd-kit、fflate、pdfjs-dist、pdf-lib、gifenc、jsQR、qrcode、heic-to、exifr、@ffmpeg/ffmpeg（單執行緒）、@jsquash、hls.js、marked、Noto Sans TC（思源黑體）、Inter。測試用 Vitest＋Testing Library＋Playwright。

第三方授權見 [THIRD_PARTY.md](THIRD_PARTY.md)；技術決定見 [docs/DECISIONS.md](docs/DECISIONS.md)；驗收紀錄見 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

## 開發

```bash
npm ci
npm run dev          # 開發伺服器
npm run typecheck    # 型別檢查
npm run lint         # ESLint
npm run test         # Vitest
npm run build        # 正式建置（dist/）
npm run preview      # 預覽正式建置
npm run test:e2e     # Playwright 截圖（需先 build；輸出到 docs/screenshots/）
npm run check:size   # 首頁 JS 大小
```

需要 Node 22 以上（見 `.nvmrc`）。

## 部署（GitHub Pages）

1. 到 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。
2. 推送到 `main`（或目前的工作分支）會觸發 `.github/workflows/deploy.yml`：型別檢查、lint、測試、建置後發布。
3. 網址格式：`https://<帳號>.github.io/<repo 名稱>/`。

使用 HashRouter 與 `base: './'`，不需要伺服器改寫設定。

## 授權

[MIT](LICENSE)
