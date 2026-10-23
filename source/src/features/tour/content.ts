/**
 * 新手導覽的內容：每個功能一個編號（只顯示在設定頁）。
 * 每個步驟可以指定畫面上的目標（CSS 選擇器）；目標不存在時（例如還沒加入檔案）改以置中卡片說明。
 */
import type { Lang } from '@/stores/settings'
import type { ModuleId } from '@/config/moduleIds'
import type { ToolId } from '@/features/pdf/tools'

export interface StepText {
  title: string
  body: string
}

export interface TourText {
  /** 導覽清單中的名稱（省略時用模組或工具名稱） */
  name?: string
  intro: string
  steps: StepText[]
  effect: string
  tip?: string
}

export type TourGroup = 'start' | 'media' | 'image' | 'pdf' | 'docs'

export interface TourDef {
  id: string
  group: TourGroup
  /** 要前往的網址（hash 路由） */
  path: string
  module?: ModuleId
  tool?: ToolId
  /** 與 steps 一一對應的目標選擇器 */
  targets: Array<string | undefined>
  text: Record<Lang, TourText>
}

const T = {
  header: '[data-tour="module-header"]',
  drop: '[data-tour="dropzone"]',
  work: '[data-tour="workspace"]',
  panel: '[data-tour="panel"]',
  topActions: '#topbar-actions',
  toolNav: '[data-tour="tool-nav"] [aria-current="page"]',
  toolGroups: '[data-tour="tool-groups"]',
}

const mod = (
  id: ModuleId,
  group: TourGroup,
  targets: Array<string | undefined>,
  text: Record<Lang, TourText>,
): TourDef => ({ id, group, path: `/${id}`, module: id, targets, text })

/** PDF 工具：共用三個步驟（工具切換列、加入檔案、操作），內容各自不同 */
const pdfTool = (
  tool: ToolId,
  scope: 'pdf' | 'pdfconvert',
  zh: { how: string; effect: string; tip?: string; file?: string },
  en: { how: string; effect: string; tip?: string; file?: string },
): TourDef => ({
  id: `pdf-${tool}`,
  group: scope === 'pdf' ? 'pdf' : 'docs',
  path: `/${scope}?tool=${tool}`,
  module: scope,
  tool,
  targets: [T.toolNav, T.drop, T.panel],
  text: {
    'zh-TW': {
      intro: zh.how.split('。')[0] + '。',
      steps: [
        { title: '工具切換列', body: '目前的工具會以亮色標示；上方這一排可以隨時換到其他工具，已加入的檔案會保留。' },
        { title: '加入檔案', body: zh.file ?? '把 PDF 拖進來，或按「選擇檔案」。檔案只在你的瀏覽器裡處理，不會上傳。' },
        { title: '怎麼用', body: zh.how },
      ],
      effect: zh.effect,
      tip: zh.tip,
    },
    en: {
      intro: en.how.split('. ')[0] + '.',
      steps: [
        { title: 'Tool switcher', body: 'The current tool is highlighted. Switch to any other tool here anytime — your files stay loaded.' },
        { title: 'Add a file', body: en.file ?? 'Drop a PDF here or click Choose file. Files are processed in your browser and never uploaded.' },
        { title: 'How to use it', body: en.how },
      ],
      effect: en.effect,
      tip: en.tip,
    },
  },
})

export const TOURS: TourDef[] = [
  {
    id: 'basics',
    group: 'start',
    path: '/',
    targets: ['[data-tour="sidebar"]', '[data-tour="search"]', '[data-tour="theme"]', '[data-tour="tasks"]'],
    text: {
      'zh-TW': {
        name: '認識介面',
        intro: '先花一分鐘認識整個網站的操作方式，之後每個工具都一樣好上手。',
        steps: [
          { title: '左側選單', body: '所有工具依「影音、圖片、PDF、文件轉換」分組；點選即可切換，正在使用的工具會亮起。' },
          { title: '搜尋與指令面板', body: '按這裡或鍵盤 Ctrl／⌘＋K，輸入關鍵字就能跳到任何工具或執行動作。' },
          { title: '深淺色主題', body: '一鍵切換淺色與深色；設定頁還能調整動畫強度與語言。' },
          { title: '任務中心', body: '轉檔、壓縮、OCR 這類較久的工作會在這裡顯示進度，可以取消或重新下載結果。' },
        ],
        effect: '所有處理都在你的瀏覽器中完成，檔案不會離開這台電腦。',
        tip: '按 ? 可以隨時查看目前工具的鍵盤快捷鍵。',
      },
      en: {
        name: 'Interface basics',
        intro: 'Take a minute to learn how the whole site works — every tool follows the same pattern.',
        steps: [
          { title: 'Sidebar', body: 'Tools are grouped into Media, Images, PDF and Conversion. Click to switch; the current tool lights up.' },
          { title: 'Search & command palette', body: 'Click here or press Ctrl/⌘+K, then type to jump to any tool or run an action.' },
          { title: 'Light & dark', body: 'Toggle the theme in one click. Settings also lets you change animation strength and language.' },
          { title: 'Task center', body: 'Longer jobs like converting, compressing or OCR show their progress here — cancel or download results again.' },
        ],
        effect: 'Everything runs inside your browser. Your files never leave this computer.',
        tip: 'Press ? anytime to see the keyboard shortcuts for the current tool.',
      },
    },
  },
  mod('player', 'media', [T.header, T.drop, '[data-tour="player-url"]'], {
    'zh-TW': {
      intro: '播放本機的影片與音樂，支援字幕、A–B 區間循環、倍速與截圖。',
      steps: [
        { title: '媒體播放器', body: '支援 MP4、WebM、MOV、MP3、FLAC 等格式，也能一次加入多個檔案成為播放清單。' },
        { title: '開啟檔案', body: '把影片、音樂或字幕檔（SRT／VTT）拖進來即可播放；字幕會自動對應到影片。' },
        { title: '串流網址', body: '也可以貼上 HLS（.m3u8）或影片網址直接播放。' },
      ],
      effect: '在 A–B 區間反覆練習、逐格檢視畫面、把喜歡的片段直接傳送到「GIF 製作」。',
      tip: '播放時按 J／K／L 倒轉、暫停、快轉，[ 與 ] 調整速度。',
    },
    en: {
      intro: 'Play local videos and music with subtitles, A–B loops, variable speed and snapshots.',
      steps: [
        { title: 'Media player', body: 'Plays MP4, WebM, MOV, MP3, FLAC and more. Add several files to build a playlist.' },
        { title: 'Open files', body: 'Drop videos, music or subtitle files (SRT/VTT); subtitles attach to the video automatically.' },
        { title: 'Stream URLs', body: 'You can also paste an HLS (.m3u8) or video URL to play it directly.' },
      ],
      effect: 'Loop an A–B section to practice, step frame by frame, or send a clip straight to the GIF maker.',
      tip: 'Use J / K / L to rewind, pause and fast-forward; [ and ] change speed.',
    },
  }),
  mod('recorder', 'media', [T.header, '[data-tour="recorder-start"]', T.panel], {
    'zh-TW': {
      intro: '錄下整個螢幕、單一視窗或瀏覽器分頁，可以同時錄進麥克風與系統聲音。',
      steps: [
        { title: '螢幕錄影', body: '不用安裝任何軟體；錄好的影片可以預覽、剪頭尾、轉成 MP4 或 GIF。' },
        { title: '開始錄影', body: '按下開始後，瀏覽器會詢問要分享哪個畫面；倒數結束就開始錄。' },
        { title: '錄影設定', body: '選擇畫質、是否錄麥克風、是否顯示攝影機泡泡；錄影庫會保留最近的作品。' },
      ],
      effect: '錄完立即得到可分享的影片，切到其他工具時也有浮動控制列可以暫停或停止。',
      tip: '從本機伺服器開啟時，錄影庫預設關閉，關閉分頁後不會留下影片。',
    },
    en: {
      intro: 'Record your whole screen, a window or a browser tab, with microphone and system audio.',
      steps: [
        { title: 'Screen recorder', body: 'Nothing to install. Preview, trim, and export recordings as MP4 or GIF.' },
        { title: 'Start recording', body: 'Press start and your browser asks which screen to share; recording begins after a countdown.' },
        { title: 'Recording options', body: 'Choose quality, microphone and a webcam bubble. The library keeps your recent recordings.' },
      ],
      effect: 'Get a shareable video instantly; a floating control bar follows you to other tools.',
      tip: 'On a local server the library is off by default, so nothing stays after you close the tab.',
    },
  }),
  mod('gif', 'media', [T.header, T.drop, T.panel], {
    'zh-TW': {
      intro: '把影片片段或多張圖片做成 GIF 動畫，大小即時預估。',
      steps: [
        { title: 'GIF 製作', body: '可以從影片擷取片段，也可以把多張圖片排成逐格動畫。' },
        { title: '加入素材', body: '拖入影片或圖片；影片會出現時間軸讓你選擇起點與終點。' },
        { title: '調整與預估', body: '設定尺寸、影格率、色彩與裁切，右側會即時預估檔案大小。' },
      ],
      effect: '輸出適合社群與聊天軟體的 GIF，畫質與大小自己決定。',
    },
    en: {
      intro: 'Turn video clips or a set of images into a GIF with a live size estimate.',
      steps: [
        { title: 'GIF maker', body: 'Grab a clip from a video, or arrange images into a frame-by-frame animation.' },
        { title: 'Add media', body: 'Drop a video or images; videos get a timeline to choose start and end.' },
        { title: 'Tune & estimate', body: 'Set size, frame rate, colors and crop — the file size updates live.' },
      ],
      effect: 'Export GIFs ready for social media and chat, balancing quality and size your way.',
    },
  }),
  mod('convert', 'image', [T.header, T.drop, T.panel], {
    'zh-TW': {
      intro: '批次轉換 JPG、PNG、WebP、AVIF、HEIC 等圖片格式。',
      steps: [
        { title: '圖片互轉', body: 'iPhone 的 HEIC 照片、網頁用的 WebP 都能轉成常見格式，也能反過來。' },
        { title: '加入圖片', body: '可一次拖入整個資料夾；重複的檔案會自動略過。' },
        { title: '選擇輸出', body: '在右側選格式、品質與尺寸，也可以指定「目標大小」自動找最佳品質。' },
      ],
      effect: '一次轉好所有圖片，打包成 ZIP 下載，並顯示每張省下多少空間。',
    },
    en: {
      intro: 'Batch-convert JPG, PNG, WebP, AVIF, HEIC and more.',
      steps: [
        { title: 'Image converter', body: 'Convert iPhone HEIC photos or web WebP images to common formats — and back.' },
        { title: 'Add images', body: 'Drop a whole folder at once; duplicates are skipped automatically.' },
        { title: 'Choose output', body: 'Pick format, quality and size, or set a target file size to find the best quality.' },
      ],
      effect: 'Convert everything in one go, download as a ZIP and see how much space you saved.',
    },
  }),
  mod('tools', 'image', [T.header, T.drop, T.work], {
    'zh-TW': {
      intro: '裁切、縮放、調色、壓縮、浮水印與馬賽克，還能移除照片的 GPS 位置。',
      steps: [
        { title: '圖片工具', body: '一次載入多張照片，每張都能單獨編輯，也能把設定套用到全部。' },
        { title: '加入圖片', body: '拖入照片後會進入工作台，左側切換工具、右側調整參數。' },
        { title: '編輯工作台', body: '所有調整都能復原；完成後可壓縮到指定大小或做成拼貼。' },
      ],
      effect: '分享前先移除位置資訊、加上浮水印，照片更安全也更專業。',
    },
    en: {
      intro: 'Crop, resize, adjust, compress, watermark and pixelate — and strip GPS location from photos.',
      steps: [
        { title: 'Image tools', body: 'Load several photos; edit each one or apply settings to all.' },
        { title: 'Add images', body: 'Drop photos to open the workbench: tools on the left, settings on the right.' },
        { title: 'Workbench', body: 'Every change can be undone. Compress to a target size or make a collage when done.' },
      ],
      effect: 'Strip location data and add watermarks before sharing — safer and more professional.',
    },
  }),
  mod('stitch', 'image', [T.header, T.drop, '[data-tour="stitch-toolbar"]', '[data-tour="stitch-stage"]', T.panel], {
    'zh-TW': {
      intro: '把多張照片自由拖曳排列，合成一張直式或橫式的長圖。',
      steps: [
        { title: '長圖拼接', body: '適合對話截圖、行程、商品詳情頁或多張照片的合輯。' },
        { title: '加入照片', body: '一次拖入多張；之後還能隨時再加入，或從其他工具「傳送到」這裡。' },
        { title: '排列方式', body: '選「直向」或「橫向」會自動排好；「統一寬度」讓每張一樣寬。拖曳任何一張就會切換成自由排列。' },
        { title: '自由拖曳', body: '直接拖曳照片移動、拖右下角圓點縮放。開啟輔助定位時，靠近其他照片的邊緣會自動吸附並出現紅色參考線。' },
        { title: '外觀與輸出', body: '調整間距、留白、圓角與背景，右側清單可以拖曳改變順序，最後選格式並合成。' },
      ],
      effect: '得到一張完整的長圖，可直接下載或傳送到其他工具繼續處理。',
      tip: '按住 Alt 拖曳可暫時關閉吸附；Ctrl／⌘＋Z 復原。',
    },
    en: {
      intro: 'Drag photos freely and combine them into one tall or wide image.',
      steps: [
        { title: 'Long image stitch', body: 'Great for chat screenshots, itineraries, product pages or photo roundups.' },
        { title: 'Add photos', body: 'Drop several at once, add more anytime, or send images here from other tools.' },
        { title: 'Arrangement', body: 'Tall or Wide lines photos up automatically; Match widths makes them equal. Dragging any photo switches to Free.' },
        { title: 'Free dragging', body: 'Drag to move and drag the corner dot to resize. With snap guides on, photos snap to nearby edges and red guide lines appear.' },
        { title: 'Look & export', body: 'Adjust spacing, margin, corners and background; reorder in the list, choose a format and stitch.' },
      ],
      effect: 'One complete long image, ready to download or send to another tool.',
      tip: 'Hold Alt while dragging to skip snapping; Ctrl/⌘+Z undoes.',
    },
  }),
  mod('qr', 'image', [T.header, '[data-tour="qr-tabs"]', T.panel], {
    'zh-TW': {
      intro: '產生好看的 QR Code（網址、Wi‑Fi、名片），或用相機與圖片掃描。',
      steps: [
        { title: 'QR Code', body: '同一個地方完成「產生」與「掃描」。' },
        { title: '產生／掃描', body: '上方切換；產生時選內容類型，掃描時可以用相機或拖入圖片。' },
        { title: '樣式', body: '調整顏色、圓點樣式、加入 Logo，並即時檢查能不能被掃描。' },
      ],
      effect: '輸出 PNG 或 SVG，印在名片或海報上都清楚。',
    },
    en: {
      intro: 'Create beautiful QR codes (links, Wi‑Fi, contacts) or scan with your camera or an image.',
      steps: [
        { title: 'QR Code', body: 'Generate and scan in one place.' },
        { title: 'Generate / scan', body: 'Switch at the top. Choose a content type to generate, or use the camera or an image to scan.' },
        { title: 'Style', body: 'Change colors and dot shapes, add a logo, and check scannability live.' },
      ],
      effect: 'Export PNG or SVG that stays crisp on cards and posters.',
    },
  }),
  {
    id: 'pdf',
    group: 'pdf',
    path: '/pdf',
    module: 'pdf',
    targets: [T.header, T.drop, T.toolGroups],
    text: {
      'zh-TW': {
        name: 'PDF 編輯器總覽',
        intro: '整理、編輯、標註、加密與最佳化 PDF，涵蓋專業 PDF 軟體的常用功能。',
        steps: [
          { title: 'PDF 編輯器', body: '所有工具共用同一個檔案匣：加入一次檔案，就能在不同工具間切換處理。' },
          { title: '拖入檔案', body: '一份 PDF 會打開檢視器，多份會進入合併；圖片與文字檔會自動轉交給對應的模組。' },
          { title: '工具分類', body: '「檢視與整理」「編輯與標註」「保護與最佳化」三大類，點任何一張卡片即可開始。' },
        ],
        effect: '不用安裝軟體、不用上傳，就能完成大部分 PDF 工作。',
        tip: '每個工具都可以在設定頁的導覽清單中單獨學習。',
      },
      en: {
        name: 'PDF editor overview',
        intro: 'Organize, edit, annotate, encrypt and optimize PDFs — the everyday pro PDF toolkit.',
        steps: [
          { title: 'PDF editor', body: 'All tools share one file tray: add a file once and switch between tools freely.' },
          { title: 'Drop files', body: 'One PDF opens the viewer, several go to Merge; images and text files are handed to the right module.' },
          { title: 'Tool groups', body: 'View & organize, Edit & annotate, Protect & optimize — click any card to start.' },
        ],
        effect: 'Handle most PDF work without installing or uploading anything.',
        tip: 'Each tool has its own tour in the Settings list.',
      },
    },
  },
  pdfTool('viewer', 'pdf', { how: '翻頁、縮放、跳頁，左側縮圖可快速捲動整份文件。', effect: '像專業閱讀器一樣流暢瀏覽大型 PDF。' }, { how: 'Flip, zoom and jump to pages; thumbnails on the left let you skim the whole file.', effect: 'Browse large PDFs as smoothly as a dedicated reader.' }),
  pdfTool('organize', 'pdf', { how: '拖曳縮圖重新排序，選取後可旋轉、刪除、複製，或插入空白頁。', effect: '頁面順序、方向一次整理好，另存成新的 PDF。' }, { how: 'Drag thumbnails to reorder; select pages to rotate, delete, duplicate or insert blanks.', effect: 'Fix page order and orientation in one pass and save a new PDF.' }),
  pdfTool('merge', 'pdf', { how: '加入多份 PDF，拖曳決定順序，每份都能指定要合併的頁範圍。', effect: '多份文件合成一份，書籤式的順序一目了然。', file: '一次拖入多份 PDF，或之後再按「加入」補上。' }, { how: 'Add several PDFs, drag to order them, and set a page range for each.', effect: 'Combine multiple documents into one, in exactly the order you want.', file: 'Drop several PDFs at once, or add more later.' }),
  pdfTool('split', 'pdf', { how: '輸入頁範圍擷取指定頁，或每 N 頁自動拆成一份。', effect: '大檔案拆成小份，或只取出需要的頁面。' }, { how: 'Extract page ranges, or split every N pages automatically.', effect: 'Break big files into smaller ones, or keep only the pages you need.' }),
  pdfTool('compare', 'pdf', { how: '加入原始與修改兩個版本，逐頁比對文字增刪，並用紅色標出畫面差異。', effect: '合約、報告改了哪裡一目了然，不必逐字對照。', file: '拖入要比較的兩份 PDF（原始版本與修改版本）。' }, { how: 'Add an original and a revised version to compare text changes page by page, with visual differences in red.', effect: 'See exactly what changed in a contract or report without reading line by line.', file: 'Drop the two PDFs to compare (original and revised).' }),
  pdfTool('crop', 'pdf', { how: '在頁面上拖曳裁切框，或選「自動去白邊」偵測內容範圍，套用到全部或指定頁。', effect: '去掉掃描檔的黑邊與多餘留白，閱讀更舒服。' }, { how: 'Drag the crop box on the page, or let Trim margins detect the content; apply to all or selected pages.', effect: 'Remove scan borders and extra whitespace for comfortable reading.' }),
  pdfTool('resize', 'pdf', { how: '選擇 A4、Letter 等紙張與邊距，內容會等比縮放並置中，直橫向自動判斷。', effect: '混雜尺寸的文件統一成同一種紙張，列印不再跑版。' }, { how: 'Choose a paper size like A4 or Letter and margins; content scales proportionally and centers, keeping each page’s orientation.', effect: 'Normalize mixed page sizes so printing just works.' }),
  pdfTool('layout', 'pdf', { how: '選擇每張紙放幾頁（2、4、9…）或「小冊子」，左側示意圖會即時顯示排列。', effect: '省紙列印講義，或印出對折就能裝訂的小冊子。', tip: '直書文件記得開啟「由右而左」。' }, { how: 'Choose pages per sheet (2, 4, 9…) or Booklet; the preview shows the arrangement live.', effect: 'Print handouts on fewer sheets, or a booklet you can fold and staple.', tip: 'Turn on Right to left for vertical CJK books.' }),
  pdfTool('annotate', 'pdf', { how: '用螢光筆、畫筆、文字框標註，或手寫簽名後放到頁面上。', effect: '不用印出來，就能在 PDF 上簽名與批註。' }, { how: 'Mark up with highlighter, pen and text boxes, or draw your signature and place it.', effect: 'Sign and comment on PDFs without printing them.' }),
  pdfTool('stamp', 'pdf', { how: '設定文字或圖片浮水印的位置、角度、透明度，或加入頁碼。', effect: '為文件加上「機密」等標示或公司 Logo。' }, { how: 'Set text or image watermarks with position, angle and opacity, or add page numbers.', effect: 'Brand documents or mark them Confidential.' }),
  pdfTool('headerFooter', 'pdf', { how: '在頁首頁尾六個位置輸入文字，可插入頁碼、日期、檔名與貝茨編號，預覽中點文字即可選取。', effect: '正式文件與法律卷宗常用的頁首頁尾、連續編號一次完成。' }, { how: 'Type into six header/footer slots and insert page numbers, dates, file names and Bates numbers; click text in the preview to select it.', effect: 'Professional headers, footers and sequential Bates numbering in one step.' }),
  pdfTool('redact', 'pdf', { how: '在頁面上拖曳畫出黑框，或搜尋文字與電話、Email、身分證等格式自動標出，最後套用。', effect: '被塗黑的內容會永久移除，不是只蓋上一層黑色。', tip: '掃描檔請先用 OCR 辨識，才能搜尋文字。' }, { how: 'Drag boxes on the page, or search text and patterns like phones, emails and IDs to mark them, then apply.', effect: 'Redacted content is permanently removed — not just covered with black.', tip: 'Run OCR on scans first so their text can be searched.' }),
  pdfTool('form', 'pdf', { how: '自動列出表單欄位，直接填寫文字、勾選或選單，可選擇鎖定成不可再改。', effect: '電子表單填好就能寄出。' }, { how: 'Form fields are listed automatically; fill text, checkboxes and menus, then optionally lock them.', effect: 'Fill out forms electronically and send them right away.' }),
  pdfTool('bookmarks', 'pdf', { how: '為頁面加入書籤、改名、拖曳排序，或用縮排做出階層；也能從大標題自動產生。', effect: '長文件有了可點選的目錄，閱讀與跳轉更方便。' }, { how: 'Add, rename and drag bookmarks, indent them into levels, or generate them from headings.', effect: 'Long documents get a clickable outline for easy navigation.' }),
  pdfTool('attachments', 'pdf', { how: '查看、下載或移除 PDF 內嵌的附件，也能把任何檔案附進去。', effect: '原始檔、試算表跟著 PDF 一起寄送，不會遺漏。' }, { how: 'View, download or remove embedded attachments, or attach any file.', effect: 'Send source files and spreadsheets together with the PDF.' }),
  pdfTool('meta', 'pdf', { how: '編輯標題、作者、主旨與關鍵字，或一鍵清除。', effect: '讓文件在搜尋與檔案總管中更容易辨識。' }, { how: 'Edit the title, author, subject and keywords, or clear them in one click.', effect: 'Make documents easier to identify in search and file browsers.' }),
  pdfTool('protect', 'pdf', { how: '設定開啟密碼（AES-256），並選擇是否允許列印、複製、修改等操作。', effect: '沒有密碼就打不開，敏感文件可以放心寄出。', tip: '密碼請另外記下，忘記就無法開啟。' }, { how: 'Set an open password (AES-256) and choose whether printing, copying and editing are allowed.', effect: 'Without the password the file can’t be opened — send sensitive documents with confidence.', tip: 'Keep the password somewhere safe; it can’t be recovered.' }),
  pdfTool('unlock', 'pdf', { how: '輸入正確密碼後，另存一份沒有保護的 PDF。', effect: '之後開啟與編輯都不必再輸入密碼。' }, { how: 'Enter the correct password and save an unprotected copy.', effect: 'Open and edit later without typing the password again.' }),
  pdfTool('sanitize', 'pdf', { how: '勾選要移除的隱藏內容：中繼資料、JavaScript、附件、註解、連結等。', effect: '公開分享前清掉可能洩漏資訊的隱藏資料。' }, { how: 'Choose hidden content to remove: metadata, JavaScript, attachments, comments, links and more.', effect: 'Strip data that could leak information before sharing publicly.' }),
  pdfTool('compress', 'pdf', { how: '把每頁轉成影像重建，選擇品質與解析度，大幅縮小掃描檔。', effect: '幾十 MB 的掃描檔縮小到可以用 Email 寄送。' }, { how: 'Rebuild each page as an image with your chosen quality and resolution to shrink scans.', effect: 'Turn tens of megabytes of scans into something you can email.' }),
  pdfTool('optimize', 'pdf', { how: '一鍵重建檔案結構、刪除無用物件並壓縮內容；損壞的檔案也會嘗試修復。', effect: '檔案更小、更穩定，畫質完全不變。' }, { how: 'Rebuild the structure, remove unused objects and compress content in one click; damaged files are repaired too.', effect: 'Smaller, sturdier files with no loss in quality.' }),
  {
    id: 'pdfconvert',
    group: 'docs',
    path: '/pdfconvert',
    module: 'pdfconvert',
    targets: [T.header, T.drop, T.toolGroups],
    text: {
      'zh-TW': {
        name: 'PDF 轉換總覽',
        intro: '在 PDF 與圖片、Word、文字之間互相轉換，掃描檔也能 OCR 辨識。',
        steps: [
          { title: 'PDF 轉換', body: '與 PDF 編輯器共用檔案匣，在這裡加入的檔案，切過去也能直接編輯。' },
          { title: '拖入檔案', body: '圖片會進入「圖片轉 PDF」，PDF 會進入「PDF 轉圖片」。' },
          { title: '轉換工具', body: '轉成 PDF、從 PDF 轉出、文字辨識三類，點卡片開始。' },
        ],
        effect: '常見的格式轉換全部在本機完成。',
      },
      en: {
        name: 'PDF convert overview',
        intro: 'Convert between PDF and images, Word and text — and OCR scanned files.',
        steps: [
          { title: 'PDF convert', body: 'Shares the file tray with the PDF editor, so files added here are ready there too.' },
          { title: 'Drop files', body: 'Images go to Images to PDF; PDFs go to PDF to images.' },
          { title: 'Conversion tools', body: 'To PDF, from PDF and text recognition — click a card to start.' },
        ],
        effect: 'All common conversions happen on your device.',
      },
    },
  },
  pdfTool('images', 'pdfconvert', { how: '拖曳排序照片，選擇紙張、方向與邊距，做成一份 PDF。', effect: '收據、作業、證件照整理成一份 PDF 方便傳送。', file: '把照片或截圖拖進來（支援 HEIC）。' }, { how: 'Drag photos into order, choose paper, orientation and margins, and make one PDF.', effect: 'Turn receipts, homework or ID photos into one easy-to-send PDF.', file: 'Drop photos or screenshots (HEIC supported).' }),
  pdfTool('toImages', 'pdfconvert', { how: '選擇格式、解析度與頁範圍，把頁面匯出成圖片，或合成一張長圖。', effect: 'PDF 內容直接貼到簡報、社群或聊天軟體。' }, { how: 'Pick a format, resolution and pages to export as images, or stitch one long image.', effect: 'Drop PDF pages straight into slides, social posts or chats.' }),
  pdfTool('toWord', 'pdfconvert', { how: '自動重建標題與段落，預覽前三頁後轉成 .docx。', effect: '在 Word、Pages 或 Google 文件中繼續編輯 PDF 的內容。', tip: '掃描檔請先用 OCR 辨識。' }, { how: 'Headings and paragraphs are rebuilt automatically; preview the first pages, then export .docx.', effect: 'Keep editing PDF content in Word, Pages or Google Docs.', tip: 'Run OCR first on scanned files.' }),
  pdfTool('text', 'pdfconvert', { how: '取出 PDF 中的文字，可以複製或存成 .txt。', effect: '快速引用文件內容。' }, { how: 'Pull out the text to copy or save as .txt.', effect: 'Quote document content quickly.' }),
  pdfTool('extractImages', 'pdfconvert', { how: '自動掃描每一頁的圖片，勾選要的再打包下載。', effect: '取回 PDF 裡的原始照片與圖表。' }, { how: 'Every page is scanned for images; pick the ones you want and download them.', effect: 'Recover the original photos and figures inside a PDF.' }),
  pdfTool('ocr', 'pdfconvert', { how: '選擇語言與精細度，辨識掃描頁面中的文字，並可做成可搜尋的 PDF。', effect: '掃描檔變成能搜尋、選取與複製文字的 PDF。', tip: '第一次使用會載入辨識引擎，之後就很快。' }, { how: 'Choose the language and detail to recognize text in scanned pages, and optionally make a searchable PDF.', effect: 'Scans become PDFs you can search, select and copy from.', tip: 'The engine loads on first use; it’s fast afterwards.' }),
  mod('doc2pdf', 'docs', [T.header, T.drop, T.panel], {
    'zh-TW': {
      intro: '把 Markdown、純文字或 RTF 檔排版成漂亮的 PDF，支援中文字型與目錄。',
      steps: [
        { title: '文字轉 PDF', body: '從「PDF 工具」獨立出來的模組，專門處理文字文件的排版。' },
        { title: '加入文字檔', body: '拖入 .md、.txt、.rtf，或直接貼上文字。' },
        { title: '排版設定', body: '選擇主題、紙張、字級與是否產生目錄，右側即時預覽結構。' },
      ],
      effect: '筆記、說明文件一鍵變成可列印、可分享的 PDF。',
    },
    en: {
      intro: 'Typeset Markdown, plain text or RTF into polished PDFs with CJK fonts and a table of contents.',
      steps: [
        { title: 'Text to PDF', body: 'Now its own module, dedicated to laying out text documents.' },
        { title: 'Add text files', body: 'Drop .md, .txt or .rtf files, or paste text directly.' },
        { title: 'Layout settings', body: 'Choose a theme, paper, font size and table of contents; the structure previews live.' },
      ],
      effect: 'Turn notes and docs into printable, shareable PDFs in one click.',
    },
  }),
]

export const TOUR_GROUPS: TourGroup[] = ['start', 'media', 'image', 'pdf', 'docs']
export const tourById = Object.fromEntries(TOURS.map((t) => [t.id, t])) as Record<string, TourDef>
/** 編號（01 起算） */
export const tourNumber = (id: string) => TOURS.findIndex((t) => t.id === id) + 1
