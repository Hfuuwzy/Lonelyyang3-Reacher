import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const context = JSON.parse(readFileSync(process.argv[2], 'utf8'))

function attempt(action) {
  try {
    action()
    return 'allowed'
  } catch (error) {
    return error.code === 'ERR_ACCESS_DENIED' ? 'denied' : `error:${error.code}`
  }
}

const outcomes = {
  contextRead: attempt(() => readFileSync(process.argv[2], 'utf8')),
  sourceRead: attempt(() => readFileSync(context.sourcePath, 'utf8')),
  sourceDirectoryRead: attempt(() => readFileSync(`${context.sourceDirectory}/record.txt`, 'utf8')),
  sourceWrite: attempt(() => writeFileSync(context.sourcePath, 'changed')),
  siblingRead: attempt(() => readFileSync(`${context.siblingDirectory}/private.txt`, 'utf8')),
  siblingWrite: attempt(() => writeFileSync(`${context.siblingDirectory}/created.txt`, 'changed')),
  unrelatedRead: attempt(() => readFileSync(context.unrelatedPath, 'utf8')),
  branchWrite: attempt(() => writeFileSync(`${context.branchDirectory}/result.txt`, 'branch output')),
  branchRead: attempt(() => readFileSync(`${context.branchDirectory}/result.txt`, 'utf8')),
  childSpawn: attempt(() => spawnSync(process.execPath, ['-e', 'process.exit(0)'])),
}

process.stdout.write(`${JSON.stringify({ type: 'preview', paragraphs: [JSON.stringify(outcomes)], pieces: [] })}\n`)
