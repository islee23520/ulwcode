export interface FileDragItemLike {
  readonly kind: string;
}

export function hasFileDragPayload(
  types: readonly string[],
  items: ArrayLike<FileDragItemLike> = [],
): boolean {
  const hasFileType = types.some((rawType) => {
    const type = rawType.toLowerCase();
    return (
      type === "files" ||
      type === "text/uri-list" ||
      type === "public.file-url" ||
      type === "public.url" ||
      type === "nsfilenamespboardtype" ||
      type === "com.apple.finder.node" ||
      type === "text/plain" ||
      type === "text" ||
      type.startsWith("application/vnd.code.") ||
      type.includes("file-url") ||
      type.includes("filename")
    );
  });

  if (hasFileType) {
    return true;
  }

  return Array.from(items).some((item) => item.kind === "file");
}
