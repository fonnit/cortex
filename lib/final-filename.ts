// Shared validator for the user-confirmed filename (Item.finalFilename).
// Used by approve, move, and create-folder mutation routes.
//
// Rules:
//   - 1..60 chars after extension stripping and whitespace collapse
//   - ASCII letters, digits, spaces, hyphens, underscores only
//   - No path separators (the allowlist regex enforces this)
//   - Any trailing ".pdf" / ".jpg" / etc. is stripped server-side; the worker
//     re-appends extname(sourcePath) on move, so the filename in the DB is
//     extension-free.

import { z } from 'zod'

export const FinalFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)  // pre-strip cap; post-strip we re-check ≤ 60
  .transform((s) => s.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim())
  .refine((s) => /^[A-Za-z0-9 _-]+$/.test(s), {
    message: 'letters / digits / space / - / _ only',
  })
  .refine((s) => s.length >= 1 && s.length <= 60, {
    message: '1-60 chars after extension is stripped',
  })

export type FinalFilename = z.infer<typeof FinalFilenameSchema>
