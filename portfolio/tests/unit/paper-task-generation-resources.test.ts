/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  generationResourceManifest,
  readGenerationResource,
  snapshotGenerationResources,
} from '../../server/paper-task/generation-resources'
import { loadSkillSnapshot, readSkillResource } from '../../server/paper-task/skill-resources.mjs'

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
  it('accepts a different self-contained analysis skill without predefined reference files', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-custom-skill-'))
    roots.push(root)
    const skill = join(root, 'custom')
    const task = join(root, 'task')
    mkdirSync(skill)
    mkdirSync(task)
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: custom-analysis\nversion: 9\n---\nRead the document and follow this workflow.')

    const snapshot = snapshotGenerationResources(task, ['deep-reading'], { 'deep-reading': skill })

    expect(snapshot.unavailableBranches).toEqual([])
    expect(snapshot.resources.map(resource => resource.relativePath)).toEqual(['SKILL.md'])
    expect(readGenerationResource(task, 'deep-reading:SKILL.md')).toContain('custom-analysis')
  })

  it.skipIf(!installedResourcesAvailable)('loads the installed pinned skills and required vendor/reference files', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-installed-resources-'))
    roots.push(root)
    const taskRoot = join(root, 'task')
    mkdirSync(taskRoot)
    const result = snapshotGenerationResources(taskRoot, ['translation', 'deep-reading'])
    expect(result.unavailableBranches).toEqual([])
    expect(result.resources.length).toBeGreaterThanOrEqual(19)
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

  it('does not require a particular translation skill identity or version', () => {
    const fixture = makeFixture({ translationVersion: '1.0.9' })
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(result.unavailableBranches).toEqual([])
    expect(result.resources.filter((resource) => resource.id.startsWith('deep-reading:'))).toHaveLength(11)
    expect(readGenerationResource(fixture.taskRoot, 'translation:SKILL.md')).toContain('1.0.9')
  })

  it('discovers available resources rather than requiring a hardcoded vendor filename', () => {
    const fixture = makeFixture()
    rmSync(join(fixture.roots.translation, 'vendor/docx/SKILL.md'))
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(result.unavailableBranches).toEqual([])
    expect(result.resources.filter((resource) => resource.id.startsWith('deep-reading:'))).toHaveLength(11)
    expect(result.resources.some((resource) => resource.id === 'translation:SKILL.md')).toBe(true)
    expect(result.resources.some((resource) => resource.id === 'translation:vendor:docx:SKILL.md')).toBe(false)
  })

  it('resolves nested skill-relative references without a references directory or framework whitelist', () => {
    const fixture = makeFixture()
    writeResource(fixture.roots['deep-reading'], 'guides/workflow.md', 'Read ../checklist.md')
    writeResource(fixture.roots['deep-reading'], 'checklist.md', 'A skill-specific review criterion.')
    snapshotGenerationResources(fixture.taskRoot, ['deep-reading'], fixture.roots)
    const resourcesRoot = join(fixture.taskRoot, 'generation-resources')

    expect(readSkillResource({ resourcesRoot, branch: 'deep-reading', path: '../checklist.md', from: 'guides/workflow.md' }).text)
      .toBe('A skill-specific review criterion.')
    expect(() => readSkillResource({ resourcesRoot, branch: 'deep-reading', path: '../../outside.md' })).toThrow('escapes')
    expect(() => readSkillResource({ resourcesRoot, branch: 'translation', path: 'SKILL.md' })).toThrow('unavailable')
    const snapshot = loadSkillSnapshot(resourcesRoot, 'deep-reading')
    const entry = snapshot.resources.find(resource => resource.path === 'SKILL.md')
    if (entry === undefined) throw new Error('entry missing')
    chmodSync(join(resourcesRoot, 'deep-reading--SKILL.md'), 0o600)
    writeFileSync(join(resourcesRoot, 'deep-reading--SKILL.md'), 'tampered')
    expect(() => loadSkillSnapshot(resourcesRoot, 'deep-reading')).toThrow('changed')
  })

  it('rejects descendant links and oversized resources while allowing the other skill branch', () => {
    const fixture = makeFixture()
    const outside = join(fixture.root, 'outside.md')
    writeFileSync(outside, 'not in the selected skill')
    symlinkSync(outside, join(fixture.roots['deep-reading'], 'escape.md'))
    const result = snapshotGenerationResources(fixture.taskRoot, ['translation', 'deep-reading'], fixture.roots)
    expect(result.unavailableBranches).toEqual(['deep-reading'])
    const oversized = makeFixture()
    writeResource(oversized.roots['deep-reading'], 'large.md', 'x'.repeat(512 * 1024 + 1))
    expect(snapshotGenerationResources(oversized.taskRoot, ['deep-reading'], oversized.roots).unavailableBranches).toEqual(['deep-reading'])
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
