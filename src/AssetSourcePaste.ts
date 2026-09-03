// Distributed under the Unlicense.

export function rewritePastedAssetSource(source: string): string {
  return source
    .replaceAll(
      "https://www.dropbox.com",
      "https://dl.dropboxusercontent.com",
    )
    .replaceAll("&dl=0", "");
}
