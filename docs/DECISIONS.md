# 技術決定紀錄

格式：決定｜理由｜放棄的替代方案

- TypeScript 使用 6.0 而非最新的 7.0｜typescript-eslint 目前只支援 < 6.1｜TS 7（lint 無法執行）
- ESLint 使用 9.x｜eslint-plugin-jsx-a11y 尚未支援 ESLint 10｜ESLint 10
- 移除 tsconfig 的 `baseUrl`，只用 `paths`｜TS 6 已棄用 baseUrl｜加 ignoreDeprecations
- Radix 使用整合套件 `radix-ui`｜單一依賴、版本一致｜逐一安裝 @radix-ui/react-*
- 主要捲動容器是 `#main-scroll`（不是 window）｜換頁時能讓舊頁維持原視覺位置淡出、shared element 以視窗座標飛行｜window 捲動（換頁時舊頁會跳動）
- 路由轉場用 `AnimatePresence mode="popLayout"`｜新舊頁同時存在才能做 layoutId 共享元素，且舊頁以絕對定位彈出，不佔版面｜mode="wait"（共享元素不穩定）
- 動畫強度「精簡」對應 `MotionConfig reducedMotion="always"`｜motion 會自動移除位移與 layout、保留透明度，正好符合規格｜每個元件自行判斷
- 動畫強度「關閉」用 `MotionGlobalConfig.skipAnimations`＋CSS 動畫歸零｜一處控制全站｜各元件判斷
- 強調色以 `@property` 註冊並以 CSS transition 400 ms 換色｜不需 JS 內插，所有使用 `--accent` 的元素同步過渡｜JS 每格內插
- 每個模組另外定義 `--accent-strong`（主按鈕底色）｜部分模組色（例如綠 #16A34A）配白字對比不到 4.5:1，按鈕需要較深變體｜直接用模組色（對比不足）
- `--text-3` 由 #667085 調整為 #5F6A7D｜原值在 surface-2 上對比 4.44:1，不到 4.5:1｜維持原值
- 深色 QR 模組強調色改用 #94A3B8／#475569｜原本的深石板色在深色背景上幾乎看不見｜沿用 #1E293B
- 首頁 JS 預算改為「只警告」｜使用者指示品質優先、不設硬上限；仍把重量級函式庫全部懶載入｜超過即讓 CI 失敗
- 部署也從工作分支觸發｜使用者要求直接部署，不經 PR 合併｜只在 main 觸發
- Logo 葉片尺寸改為 34×12（四角對齊 8／56）｜原 32 長度使四角不齊｜保留 32
