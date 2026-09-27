// Loads and validates src/data/resume.yaml at build time.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';

// "YYYY-MM" (YAML may parse it as a string) or "present"
const month = z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal('present')]);

const schema = z.object({
  sample: z.boolean().default(false),
  headline: z.string(),
  location: z.string().optional(),
  summary: z.string().optional(),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().optional(),
      start: month,
      end: month,
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      start: month.optional(),
      end: month,
      notes: z.string().optional(),
    }),
  ),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  projects: z
    .array(z.object({ name: z.string(), description: z.string(), link: z.url().nullable().default(null) }))
    .default([]),
});

export type Resume = z.infer<typeof schema>;

export const resume: Resume = schema.parse(parse(readFileSync('src/data/resume.yaml', 'utf8')));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2023-07" → "Jul 2023"; "present" → "Present" */
export function formatMonth(value: string): string {
  if (value === 'present') return 'Present';
  const [y, m] = value.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatRange(start: string | undefined, end: string): string {
  return start ? `${formatMonth(start)} – ${formatMonth(end)}` : formatMonth(end);
}
