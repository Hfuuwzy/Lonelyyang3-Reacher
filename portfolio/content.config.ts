import { defineCollection, defineContentConfig, z } from '@nuxt/content'

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
  },
})
