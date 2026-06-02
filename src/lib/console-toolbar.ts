/** Console 请求编辑区顶部工具栏容器：窄屏换行，md 及以上单行排列。 */
export const CONSOLE_REQUEST_TOOLBAR_CLASS =
  "flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:flex-wrap sm:items-center md:flex-nowrap";

/** 工具栏按钮组：移动端独立换行，sm+ 参与外层 flex 布局。 */
export const CONSOLE_TOOLBAR_ACTIONS_CLASS = "flex flex-wrap gap-3 sm:contents";

/** 工具栏操作按钮：禁止收缩，避免文字溢出按钮边界。 */
export const CONSOLE_TOOLBAR_BUTTON_CLASS = "shrink-0 whitespace-nowrap";

/** 工具栏按钮内图标：固定尺寸，避免被 flex 挤压。 */
export const CONSOLE_TOOLBAR_ICON_CLASS = "mr-2 h-4 w-4 shrink-0";

/** 请求名称输入框：优先吸收剩余宽度，窄屏时占满一行。 */
export const CONSOLE_REQUEST_NAME_INPUT_CLASS = "w-full sm:min-w-0 sm:flex-1 md:min-w-[12rem]";
