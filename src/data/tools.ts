/**
 * HTML 小工具清單
 * 每個工具對應 public/blog/ 或其他 public/ 子目錄中的靜態 HTML 檔案。
 * 新增工具時，請在此陣列加入一個物件。
 */
export interface Tool {
  /** 工具名稱（顯示用） */
  name: string;
  /** 工具簡短描述 */
  desc: string;
  /** 工具路徑（相對於網站根目錄，以 / 開頭） */
  href: string;
  /** 分類標籤，用於篩選 */
  tags: string[];
}

export const TOOLS: Tool[] = [
  {
    name: "表單產生器",
    desc: "快速產生 LINE / Google 表單連結，方便分享給成員填寫。",
    href: "/blog/genform.html",
    tags: ["表單", "LINE"],
  },
  {
    name: "表單填寫頁",
    desc: "通用表單填寫介面。",
    href: "/blog/form.html",
    tags: ["表單"],
  },
  {
    name: "時間記錄工具",
    desc: "快速記錄工作時間與任務，產生摘要報告。",
    href: "/blog/timeRecordTool.html",
    tags: ["生產力", "時間管理"],
  },
  {
    name: "LINE 儀表板 (最新版)",
    desc: "LINE 群組訊息數據可視化儀表板。",
    href: "/blog/line_dashboard_v11_demo.html",
    tags: ["LINE", "數據分析"],
  },
  {
    name: "UI 模型草稿",
    desc: "快速繪製 UI 線框圖（Wireframe）與介面草稿。",
    href: "/blog/ui-mockup.html",
    tags: ["設計", "UI"],
  },
  {
    name: "自動排版草稿",
    desc: "中英文混排自動加空格的排版輔助工具。",
    href: "/blog/AutoSpacingDraftDemo.html",
    tags: ["文字處理", "排版"],
  },
  {
    name: "IG 圖片產生器",
    desc: "快速產生符合 Instagram 比例的貼文圖片。",
    href: "/blog/IG_image.html",
    tags: ["設計", "社群媒體"],
  },
  {
    name: "間距計算器",
    desc: "計算排版間距的小工具。",
    href: "/blog/Spacing Calc.html",
    tags: ["設計", "排版"],
  },
  {
    name: "Ways of Working 產生器",
    desc: "快速產生團隊工作方式說明文件。",
    href: "/blog/ways_of_working_generator.html",
    tags: ["生產力", "團隊"],
  },
  {
    name: "SCF 表單",
    desc: "SCF 相關表單工具。",
    href: "/blog/SCF.html",
    tags: ["表單"],
  },
  {
    name: "Google Docs 友善閱讀器",
    desc: "改善 Google Docs 在手機的閱讀體驗，支援大綱導覽與字型調整。",
    href: "/reader/",
    tags: ["閱讀", "Google Docs"],
  },
  {
    name: "PowerNote 筆記工具",
    desc: "功能強大的本地筆記應用程式，支援 Mermaid 圖表與雙螢幕模式。",
    href: "/powernote/",
    tags: ["筆記", "生產力"],
  },
  {
    name: "詩歌搜尋",
    desc: "全文搜尋詩歌歌詞，方便聚會使用。",
    href: "/2-4/Hymns.html",
    tags: ["聚會", "搜尋"],
  },
  {
    name: "聖經搜尋",
    desc: "快速搜尋聖經經文。",
    href: "/2-4/Bible.html",
    tags: ["聚會", "搜尋"],
  },
  {
    name: "生命讀經搜尋",
    desc: "搜尋生命讀經內容。",
    href: "/2-4/LifeStudy.html",
    tags: ["聚會", "搜尋"],
  },
];
