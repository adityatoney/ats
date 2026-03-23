import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { ConvexHttpClient } from 'convex/browser';

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error('CONVEX_URL environment variable is not set');
}

export const convex = new ConvexHttpClient(convexUrl.replace(/\/$/, ''));

/**
 * Normalize a Convex document for API responses.
 * Adds `id` = `_id` so the frontend can use `obj.id` consistently.
 */
export function normalize<T extends Record<string, any>>(doc: T): T & { id: string } {
  if (!doc) return doc;
  return { ...doc, id: doc._id };
}

/**
 * Normalize an array of Convex documents.
 */
export function normalizeAll<T extends Record<string, any>>(docs: T[]): Array<T & { id: string }> {
  return docs.map(normalize);
}
