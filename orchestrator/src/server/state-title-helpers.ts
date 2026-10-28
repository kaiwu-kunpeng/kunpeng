function fileStem(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

export function htmlReportTitle(raw: string, file: string): string {
  const match = /<title>(.*?)<\/title>/is.exec(raw);
  return match?.[1]?.trim() || fileStem(file);
}

export function htmlDocTitle(raw: string, file: string): string {
  const match = /<title>(.*?)<\/title>/is.exec(raw);
  return match?.[1]?.replace(/<[^>]*>/g, "").trim() || fileStem(file);
}

export function markdownReportTitle(raw: string, file: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) return match[1].trim();
  }
  return fileStem(file);
}
