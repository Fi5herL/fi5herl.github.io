export const SITE = {
  website: "https://fi5herl.github.io/",
  author: "Fi5herL",
  profile: "https://github.com/Fi5herL",
  desc: "住在北投的喜樂基督徒，分享生活、科技與學習筆記。",
  title: "Fi5her Blog",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 6,
  postPerPage: 8,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  showTools: true,
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "https://github.com/Fi5herL/fi5herl.github.io/edit/main/src/data/blog/",
  },
  dynamicOgImage: false,
  dir: "ltr",
  lang: "zh-TW",
  timezone: "Asia/Taipei",
  /**
   * Default sort order for blog posts.
   * "date-desc"    — newest first (default)
   * "pinned-date"  — pinned posts (sortOrder asc) first, then newest first
   */
  defaultSort: "pinned-date" as "date-desc" | "pinned-date",
} as const;
