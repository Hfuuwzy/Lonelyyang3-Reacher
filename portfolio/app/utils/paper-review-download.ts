/**
 * Browser-only helper: downloads a text blob as a file. Kept separate from the
 * pure Markdown projection so the projection stays unit-testable in node.
 */

export function paperReviewDownloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}