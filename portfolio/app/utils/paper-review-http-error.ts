/**
 * Maps a pre-stream HTTP status from the paper-review upload route to an
 * actionable user-facing message. Only the numeric status code drives the
 * copy: the response body and request fields are never read, so untrusted
 * server output cannot leak into the UI.
 *
 * Browser-safe: pure function of a number, no DOM or fetch APIs.
 */

/** Matches the upload route's pre-parse cap (`server/utils/paper-review/multipart.ts`). */
export const PAPER_REVIEW_UPLOAD_LIMIT_MIB = 50

export function paperReviewHttpErrorMessage(status: number): string {
  if (status === 400) {
    return '上传请求被本地审阅端点拒绝（HTTP 400）：上传参数无效或格式错误。请确认已选择 PDF 文件并完整填写提供方配置后重新提交。'
  }
  if (status === 413) {
    return `上传文件超过 ${PAPER_REVIEW_UPLOAD_LIMIT_MIB} MiB 上限（HTTP 413），本地审阅端点拒绝接收。请压缩或更换 PDF 后重新提交。`
  }
  return `本地审阅端点返回异常（HTTP ${status}）。请确认后端审阅路由已实现且开发服务器正在运行。`
}
