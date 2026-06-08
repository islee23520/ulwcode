import { detectAiToolName } from "../../types";
import type { AiToolConfig } from "../../types";

function findToolConfig(
  toolName: string,
  aiTools: AiToolConfig[],
): AiToolConfig | undefined {
  return aiTools.find(
    (tool) =>
      tool.name === toolName ||
      tool.operator === toolName ||
      (tool.aliases ?? []).includes(toolName),
  );
}

function getToolBadgeText(tool: AiToolConfig): string {
  const preset = {
    opencode: "OC",
    claude: "CC",
    codex: "CX",
  }[tool.name];
  if (preset) {
    return preset;
  }

  return tool.label
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function renderToolBadge(
  toolName: string | undefined,
  aiTools: AiToolConfig[],
): string {
  if (!toolName || aiTools.length === 0) {
    return "";
  }

  const tool = findToolConfig(toolName, aiTools);
  if (!tool) {
    return "";
  }

  return `<span class="pane-tool-badge ${escapeHtml(tool.name)}" title="${escapeHtml(tool.label)}">${escapeHtml(getToolBadgeText(tool))}</span>`;
}

export function detectToolIcon(
  currentCommand: string | undefined,
  aiTools: AiToolConfig[],
): string {
  return renderToolBadge(detectAiToolName(currentCommand, aiTools), aiTools);
}

export function escapeHtml(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
