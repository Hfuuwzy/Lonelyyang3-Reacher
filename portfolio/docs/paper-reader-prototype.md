# Paper reader prototype

`/prototype/paper-reader` is the Nuxt-hosted normalization of the disposable issue-37 reader. It is a development-only comparison surface, not a production reader or paper-processing workflow.

## Run it

From `portfolio/`, start the existing Nuxt development server:

```powershell
npm run dev
```

Open `/prototype/paper-reader` on that server. No standalone HTML file or `127.0.0.1:43737` server is part of the canonical workflow. The existing `pages:extend` production exclusion keeps `/prototype/` routes out of production.

## Layout comparison

The default is the selected C focused-reading layout. Add `?variant=A`, `?variant=B`, or `?variant=C` to compare the three layouts on the same sample. These variants are comparison views, not persistent user preferences.

C has a compact toolbar with no brand row. It provides a return link to the existing `/prototype/paper-review`, a table-of-contents control, and a reading-status label. A short title appears only after the article's main heading scrolls out of view. The toolbar is centered with a `1240px` maximum width, rather than stretching edge to edge. Its controls stay within the centered toolbar.

The page uses the existing warm paper and ink tokens. The reading column is about `760px` wide, with `20px` desktop text and `18px` mobile text. The table of contents opens in a drawer with touch targets of at least `44px`; keyboard focus is managed, and Escape closes the drawer.

## Synthetic data and limits

All article content and PDF files are synthetic fixtures. While the translated PDF is not ready, its open and download actions remain disabled and the page gives a useful status. The original PDF is a separate, secondary action.

The prototype does not use a model, a real paper, or the production task flow. It makes no claims about real Markdown safety, extraction, translation, or paper-quality checks. It is not evidence that those production capabilities exist.

## Migration and verification

This Nuxt page is the canonical implementation. The six files of the former `.opencode/prototypes/issue-37/` standalone page and server were removed after verification.

Recorded checks: 10 focused SFC compilation cases passed, the fixture passed a strict TypeScript CLI check, and `npm run build` completed. An actual production-server request returned 404 for the reader while the homepage returned 200. Bounded browser checks covered desktop, laptop, tablet, and mobile; PDF states, title switching, and the modal drawer's normal/reduced-motion focus behavior passed. Independent source and visual reviews passed. No E2E suite or real-paper/model run was performed.
