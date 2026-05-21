import html from "./tmux-toolbar.html?raw";

export function renderTmuxToolbar(showTmuxWindowControls = true): string {
  if (showTmuxWindowControls) {
    return html;
  }

  return html.replace(
    'class="tmux-window-controls" data-tmux-window-controls',
    'class="tmux-window-controls hidden" data-tmux-window-controls',
  );
}
