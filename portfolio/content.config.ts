import { defineCollection, defineContentConfig, z } from '@nuxt/content'
import { resolve } from 'node:path'

export default defineContentConfig({
  collections: {
    blog: defineCollection({
      type: 'page',
      source: 'blog/**/*.md',
      schema: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        date: z.coerce.date().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        cover: z.string().optional(),
      }),
    }),
    research: defineCollection({
      type: 'page',
      source: {
        cwd: resolve('reference/research/documents'),
        include: 'deepseek-harness-open-source-and-api-requirements.md',
        prefix: '/research',
      },
      schema: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        date: z.coerce.date().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    }),
  },
})
