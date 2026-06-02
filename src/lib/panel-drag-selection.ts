export function lockPanelDragSelection(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  const preventSelect = (event: Event) => {
    event.preventDefault();
  };

  document.addEventListener("selectstart", preventSelect);
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";

  return () => {
    document.removeEventListener("selectstart", preventSelect);
    document.body.style.userSelect = previousUserSelect;
  };
}
