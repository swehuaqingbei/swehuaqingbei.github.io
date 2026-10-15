// 赛事配置：只需要改这里
window.CONFIG = {
  // Google Sheet 的 ID（链接里 /d/ 和 /edit 之间那一段）。留空则使用内置默认赛程。
  SHEET_ID: '11-ZvJp2n__N1pIRX6BgieiuYb7MT2SAG1gc-y2qArtU',
  // 表格里两个工作表（tab）的名字，需与 Google Sheet 中保持一致
  MATCH_TAB: '比赛',
  RANK_TAB: '球队',  // 球队设置：手动排名、球衣颜色（旧名「排名调整」也兼容）
  // 自动刷新间隔（毫秒）
  REFRESH_MS: 30000,
};
