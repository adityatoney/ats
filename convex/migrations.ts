import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Batch insert for migration — inserts multiple documents into a table
export const batchInsert = mutation({
  args: {
    table: v.string(),
    documents: v.array(v.any()),
  },
  handler: async (ctx, { table, documents }) => {
    const ids: string[] = [];
    for (const doc of documents) {
      const id = await ctx.db.insert(table as any, doc);
      ids.push(id);
    }
    return ids;
  },
});

// Patch a single document (used for self-referencing FK second pass)
export const patchDocument = mutation({
  args: {
    id: v.string(),
    patch: v.any(),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id as any, patch);
  },
});

// Clear a batch of documents in a table (for re-running migration)
// Returns number deleted. Call repeatedly until returns 0.
export const clearTableBatch = mutation({
  args: { table: v.string(), batchSize: v.optional(v.float64()) },
  handler: async (ctx, { table, batchSize }) => {
    const limit = batchSize ?? 500;
    const result = await ctx.db.query(table as any).paginate({ numItems: limit, cursor: null });
    for (const doc of result.page) {
      await ctx.db.delete((doc as any)._id);
    }
    return result.page.length;
  },
});

// Legacy clearTable kept for small tables
export const clearTable = mutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    const docs = await ctx.db.query(table as any).collect();
    for (const doc of docs) {
      await ctx.db.delete((doc as any)._id);
    }
    return docs.length;
  },
});

// Count documents in a table (paginated to avoid 16MB read limit)
export const countTable = query({
  args: { table: v.string(), cursor: v.optional(v.string()), pageSize: v.optional(v.float64()) },
  handler: async (ctx, { table, cursor, pageSize }) => {
    const limit = pageSize ?? 8000;
    const result = await ctx.db.query(table as any).paginate({
      numItems: limit,
      cursor: cursor === undefined ? null : (cursor as any),
    });
    return {
      count: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Verify referential integrity for a single table's FK fields (paginated)
export const verifyRefIntegrityPage = query({
  args: {
    table: v.string(),
    fields: v.array(v.object({ name: v.string(), optional: v.boolean() })),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.float64()),
  },
  handler: async (ctx, { table, fields, cursor, pageSize }) => {
    const limit = pageSize ?? 500;
    const result = await ctx.db.query(table as any).paginate({
      numItems: limit,
      cursor: cursor === undefined ? null : (cursor as any),
    });

    const errors: string[] = [];
    for (const doc of result.page) {
      for (const { name: field, optional } of fields) {
        const refId = (doc as any)[field];
        if (!refId) {
          if (!optional) {
            errors.push(`${table}/${(doc as any)._id}: ${field} is null but not optional`);
          }
          continue;
        }
        const target = await ctx.db.get(refId);
        if (!target) {
          errors.push(`${table}/${(doc as any)._id}: ${field}=${refId} not found`);
        }
      }
    }

    return {
      errors,
      checked: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Count documents with a field missing (paginated for large tables)
export const countMissingFieldPage = query({
  args: { table: v.string(), field: v.string(), cursor: v.optional(v.string()), pageSize: v.optional(v.float64()) },
  handler: async (ctx, { table, field, cursor, pageSize }) => {
    const limit = pageSize ?? 2000;
    const result = await ctx.db.query(table as any).paginate({
      numItems: limit,
      cursor: cursor === undefined ? null : (cursor as any),
    });
    const missing = result.page.filter((d: any) => d[field] === undefined || d[field] === null).length;
    return {
      missing,
      checked: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Get pgId → _id mappings for a table with pagination (used for resume support)
export const getPgIdMappingsPage = query({
  args: { table: v.string(), cursor: v.optional(v.string()), pageSize: v.optional(v.float64()) },
  handler: async (ctx, { table, cursor, pageSize }) => {
    const limit = pageSize ?? 4000;
    const result = await ctx.db.query(table as any).paginate({
      numItems: limit,
      cursor: cursor ?? null,
    });
    return {
      items: result.page.map((d: any) => ({ pgId: d.pgId, _id: d._id })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get documents by pgId (for spot checks)
export const getByPgId = query({
  args: { table: v.string(), pgId: v.string() },
  handler: async (ctx, { table, pgId }) => {
    const docs = await ctx.db.query(table as any).collect();
    return docs.find((d: any) => d.pgId === pgId) ?? null;
  },
});
