/** Console 请求编辑区顶部工具栏容器：空间不足时保持对齐并自然换行。 */
export const CONSOLE_REQUEST_TOOLBAR_CLASS =
  "flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3";

/** 工具栏按钮组：按钮紧凑排列并在窄屏自动换行。 */
export const CONSOLE_TOOLBAR_ACTIONS_CLASS = "flex flex-wrap items-center gap-2";

/** 工具栏操作按钮：禁止收缩，避免文字溢出按钮边界。 */
export const CONSOLE_TOOLBAR_BUTTON_CLASS = "h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs";

/** 工具栏按钮内图标：固定尺寸，避免被 flex 挤压。 */
export const CONSOLE_TOOLBAR_ICON_CLASS = "mr-1.5 h-4 w-4 shrink-0";

/** 请求名称输入框：填满标签右侧的剩余空间。 */
export const CONSOLE_REQUEST_NAME_INPUT_CLASS = "h-9 min-w-0 flex-1 rounded-md text-sm";
