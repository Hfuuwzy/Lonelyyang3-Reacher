/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  generationResourceManifest,
  readGenerationResource,
  snapshotGenerationResources,
} from '../../server/paper-task/generation-resources'

const translationFiles = [
  'SKILL.md', 'references/translation_rules.md', 'references/markdown_rules.md',
  'references/dependencies.md', 'references/qa_checklist.md', 'references/vendor_notes.md',
  'vendor/pdfs/SKILL.md', 'vendor/docx/SKILL.md',
]
const deepReadingFiles = [
  'SKILL.md', 'references/5w2h_analysis.md', 'references/comparison_matrix.md',
  'references/critical_thinking.md', 'references/first_principles.md',
  'references/inversion_thinking.md', 'references/mental_models.md',
  'references/output_templates.md', 'references/scqa_framework.md',
  'references/six_hats.md', 'references/systems_thinking.md',
]
const roots: string[] = []
const installedTranslationRoot = join(homedir(), '.skills', 'myCreatsSkills', 'academic-paper-translation-skill', 'academic-paper-translation-skill')
const installedDeepReadingRoot = resolve(process.cwd(), '..', '.opencode', 'skills', 'deep-reading-analyst')
const installedResourcesAvailable = translationFiles.every((path) => existsSync(join(installedTranslationRoot, path)))
  && deepReadingFiles.every((path) => existsSync(join(installedDeepReadingRoot, path)))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paper task pinned generation resources', () => {
  it.skipIf(!installedResourcesAvailable)('loads the installed pinned skills and required vendor/reference files', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-installed-resources-'))
    roots.push(root)
    const taskRoot = join(root, 'task')
    mkdirSync(taskRoot)
    const result = snapshotGenerationResources(taskRoot, ['translation', 'deep-reading'])
    expect(result.unavailableBranches).toEqual([])
    expect(result.resources).toHaveLength(19)
    expect(readGenerationResource(taskRoot, 'translation:vendor:pdfs:SKILL.md'))
      .toBe(readFileSync(join(installedTranslationRoot, 'vendor/pdfs/SKILL.md'), 'utf8'))
    expect(readGenerationResource(taskRoot, 'translation:vendor:docx:SKILL.md'))
      .toBe(readFileSync(join(installedTranslationRoot, 'vendor/docx/SKILL.md'), 'utf8'))
    expect(readGenerationResource(taskRoot, 'deep-reading:references:systems_thinking.md'))
      .toBe(readFileSync(join(installedDeepReadingRoot, 'references/systems_thinking.md'), 'utf8'))
  })

  it('snapshots real bytes with content hashes and reuses them on continuation', () => {
    const fixture = makeFixture()
    const taskRoot = join(fixture.root, 'task')
    const first = snapshotGenerationResources(taskRoot, ['translation', 'deep-reading'], fixture.roots)
    const originalSkill = readFileSync(join(fixture.roots.translation, 'SKILL.md'), 'utf8')
    const skillId = 'translation:SKILL.md'
    const entry = generationResourceManifest(taskRoot).find((item) => item.id === skillId)
    expect(first.unavailableBranches).toEqual([])
    expect(first.resources).toHaveLength(19)
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(readGenerationResource(taskRoot, skillId)).toBe(originalSkill)

    writeFileSync(join(fixture.roots.translation, 'SKILL.md'), `${originalSkill}\nchanged upstream`)
    const continuation = snapshotGenerationResources(taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(continuation.unavailableBranches).toEqual([])
    expect(readGenerationResource(taskRoot, skillId)).toBe(originalSkill)
    expect(continuation.resources.find((item) => item.id === skillId)?.sha256).toBe(entry?.sha256)
  })

  it('marks only the selected branch unavailable for a wrong pinned version', () => {
    const fixture = makeFixture({ translationVersion: '1.0.9' })
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(result.unavailableBranches).toEqual(['translation'])
    expect(result.resources.filter((resource) => resource.id.startsWith('deep-reading:'))).toHaveLength(11)
    expect(readGenerationResource(fixture.taskRoot, 'translation:SKILL.md')).toBeUndefined()
  })

  it('marks a selected branch unavailable when one required resource is missing', () => {
    const fixture = makeFixture()
    rmSync(join(fixture.roots.translation, 'vendor/docx/SKILL.md'))
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(result.unavailableBranches).toEqual(['translation'])
    expect(result.resources.filter((resource) => resource.id.startsWith('deep-reading:'))).toHaveLength(11)
    expect(result.resources.some((resource) => resource.id === 'translation:SKILL.md')).toBe(false)
  })

  it('does not fail an unselected missing branch', () => {
    const fixture = makeFixture()
    rmSync(join(fixture.roots['deep-reading'], deepReadingFiles[4] ?? ''))
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation'], fixture.roots)
    expect(result.unavailableBranches).toEqual([])
    expect(result.resources.every((resource) => resource.id.startsWith('translation:'))).toBe(true)
  })
})

function makeFixture(options: { readonly translationVersion?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-resources-'))
  roots.push(root)
  const translation = join(root, 'translation')
  const deepReading = join(root, 'deep-reading')
  mkdirSync(translation)
  mkdirSync(deepReading)
  for (const path of translationFiles) {
    const contents = path === 'SKILL.md'
      ? `---\nname: academic-paper-zh-translation\nversion: ${options.translationVersion ?? '1.1.0'}\n---\nPinned translation skill.\n`
      : `translation reference: ${path}\n`
    writeResource(translation, path, contents)
  }
  for (const path of deepReadingFiles) writeResource(deepReading, path, `deep reading reference: ${path}\n`)
  const taskRoot = join(root, 'task')
  mkdirSync(taskRoot)
  return { root, taskRoot, roots: { translation, 'deep-reading': deepReading } }
}

function writeResource(root: string, relativePath: string, contents: string): void {
  const path = join(root, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}
