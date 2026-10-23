# JayAng Studio Web

檔案不上傳，全部在你的瀏覽器裡完成。媒體播放器、螢幕錄影、GIF 製作、圖片互轉、圖片工具、長圖拼接、QR Code、PDF 編輯器、PDF 轉換、文字轉 PDF。

這個資料夾同時是：

- **可以直接放上 GitHub Pages 的網站**（最外層就是建置好的網站）；
- **可以在自己電腦用本機伺服器開啟的版本**（`local-server/` 資料夾）；
- **完整原始碼**（`source/` 資料夾）。

---

## 一、放到 GitHub Pages

1. 把整個資料夾（包含 `.github`、`source`、`local-server`）推送到 GitHub 儲存庫的 `main` 分支。
2. 到儲存庫的 **Settings → Pages**，把 **Source** 設為 **GitHub Actions**。
3. 之後每次推送到 `main`，`.github/workflows/deploy.yml` 會自動發布最外層的網站（`source/`、`local-server/` 與本說明不會被發布）。

> 網站使用相對路徑與 `#/` 路由，放在 `https://帳號.github.io/儲存庫名稱/` 這種子路徑也能正常運作，也能安裝成 App（PWA）離線使用。

## 二、在自己電腦開啟（本機伺服器）

需要 **Node.js 18 以上** 或 **Python 3.8 以上**（擇一即可，不必安裝其他套件）。

| 系統 | 做法 |
|---|---|
| Windows | 雙擊 `local-server/start-windows.bat` |
| macOS | 雙擊 `local-server/start-mac.command`（第一次若被擋，按右鍵 → 打開） |
| Linux | 執行 `local-server/start-linux.sh` |
| 手動 | `node local-server/server.mjs` 或 `python3 local-server/server.py` |

會在 **http://127.0.0.1:8080/** 啟動並自動開啟瀏覽器；要換連接埠可以加參數，例如 `node local-server/server.mjs 8081`。關閉視窗（或按 Ctrl+C）即停止。

> 不能直接雙擊 `index.html` 以 `file://` 開啟——瀏覽器會擋下模組與 WebAssembly，必須透過伺服器。用其他伺服器（例如 VS Code Live Server、`python -m http.server 8080`）也可以。

### 關閉後不留下任何東西（本機伺服器模式）

從 `localhost`、`127.0.0.1` 開啟時，網站會自動進入「本機伺服器模式」：

- **不安裝 Service Worker、不建立離線快取**——伺服器關掉後，網址就真的打不開，不會再出現「伺服器關了網站還在」的情況；
- 舊版本留下的 Service Worker 與快取，第一次用新版本開啟時會**自動移除**；
- 設定只存在這個分頁（sessionStorage），**關閉分頁就消失**；
- 錄影庫預設關閉、OCR 語言資料與中文字型不寫入瀏覽器儲存空間；
- 內附的 `local-server` 伺服器對所有檔案送出 `Cache-Control: no-store`，瀏覽器不會把網站存進 HTTP 快取。

### 手動清除舊版本留下的資料

如果之前用舊版本開過 `127.0.0.1:8080`，可以用以下任一方法清乾淨：

1. **最簡單**：用新版本開啟網站 → **設定 → 資料 → 清除這個網站的所有資料**。
2. **Chrome／Edge**：在 `http://127.0.0.1:8080` 按 **F12** → **Application（應用程式）** → 左側 **Storage（儲存空間）** → **Clear site data（清除網站資料）**。
3. **Chrome／Edge（不開網站）**：網址列輸入 `chrome://settings/content/all`（Edge 為 `edge://settings/content/all`），搜尋 `127.0.0.1`，按垃圾桶刪除；或到 `chrome://serviceworker-internals` 找到 `127.0.0.1:8080` 按 **Unregister**。
4. **Firefox**：設定 → 隱私權與安全性 → Cookie 與網站資料 → **管理資料**，搜尋 `127.0.0.1` 後移除。
5. **Safari**：設定 → 隱私權 → **管理網站資料**，搜尋 `127.0.0.1` 後移除。

---

## 三、功能分類

| 類別 | 工具 |
|---|---|
| 影音 | 媒體播放器、螢幕錄影、GIF 製作 |
| 圖片 | 圖片互轉、圖片工具、**長圖拼接（新）**、QR Code |
| PDF（PDF 編輯器） | 檢視器、整理頁面、合併、分割、**比較文件、裁切頁面、頁面尺寸、多頁合一與小冊子**、標註與簽名、浮水印與頁碼、**頁首頁尾與貝茨編號、塗黑遮蔽**、填寫表單、**書籤、附件**、文件資訊、**加密保護（AES-256）**、移除密碼、**清除隱藏資訊**、掃描式壓縮、**最佳化與修復** |
| 文件轉換 | **PDF 轉換**（圖片轉 PDF、PDF 轉圖片／長圖、**PDF 轉 Word、擷取圖片、OCR 文字辨識**、擷取文字）、**文字轉 PDF**（獨立成模組） |

- **新手導覽**：設定 → 新手導覽 → 開啟「新手導覽模式」，會列出每個功能的編號；點編號就會跳到該功能，以聚光燈動畫一步步介紹用法與效果。
- 所有處理（包含 OCR）都在瀏覽器內完成，不連到任何第三方伺服器。

---

## 四、開發（原始碼在 `source/`）

```bash
cd source
npm ci                 # 安裝依賴（Node.js 22 以上）
npm run dev            # 開發伺服器
npm test               # 單元測試（Vitest）
npm run typecheck      # 型別檢查
npm run lint           # ESLint
npm run publish:root   # 重新建置，並更新最外層的網站成品
```

修改原始碼後執行 `npm run publish:root`，再把整個資料夾推上 GitHub 即可。
