#!/usr/bin/env npx tsx
/**
 * One-shot migration script: PostgreSQL → Convex
 *
 * Reads all data from Postgres (via the postgres package) and writes to Convex
 * (via ConvexHttpClient) in topological order respecting FK dependencies.
 *
 * Usage: npx tsx scripts/migrate-to-convex.ts
 */

import 'dotenv/config';
import postgres from 'postgres';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const DATABASE_URL = process.env.DATABASE_URL;
const CONVEX_URL = process.env.CONVEX_URL;

if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
if (!CONVEX_URL) throw new Error('CONVEX_URL not set');

const sql = postgres(DATABASE_URL);
const convex = new ConvexHttpClient(CONVEX_URL.replace(/\/$/, ''));

const BATCH_SIZE = 100;

// Tables with potentially large documents need smaller batch sizes
// (Payloads are now truncated via sanitizePayload, so we can use larger batches)
const TABLE_BATCH_SIZES: Record<string, number> = {
  agentEvents: 25,
  checkpoints: 10,
  soulVersions: 50,
  portfolioSnapshots: 50,
};

// ID mapping: Postgres UUID → Convex _id
const idMaps: Record<string, Map<string, string>> = {
  users: new Map(),
  projects: new Map(),
  agents: new Map(),
  strategyVersions: new Map(),
  soulVersions: new Map(),
  runs: new Map(),
  orders: new Map(),
  fills: new Map(),
  positions: new Map(),
  portfolioSnapshots: new Map(),
  agentEvents: new Map(),
  checkpoints: new Map(),
  branches: new Map(),
  tournaments: new Map(),
  tournamentEntries: new Map(),
  leaderboardEntries: new Map(),
};

// ── Conversion helpers ──

function tsToMs(ts: Date | string | null | undefined): number | undefined {
  if (ts === null || ts === undefined) return undefined;
  return new Date(ts).getTime();
}

function numToFloat(val: string | number | null | undefined): number | undefined {
  if (val === null || val === undefined) return undefined;
  return typeof val === 'number' ? val : parseFloat(val);
}

function numToFloatRequired(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return typeof val === 'number' ? val : parseFloat(val);
}

function resolveFk(table: string, pgUuid: string | null | undefined): string | undefined {
  if (!pgUuid) return undefined;
  const id = idMaps[table]?.get(pgUuid);
  if (!id) throw new Error(`FK resolution failed: ${pgUuid} not found in ${table} idMap`);
  return id;
}

function resolveFkRequired(table: string, pgUuid: string): string {
  const id = idMaps[table]?.get(pgUuid);
  if (!id) throw new Error(`FK resolution failed: ${pgUuid} not found in ${table} idMap`);
  return id;
}

// ── Batch insert helper ──

async function batchInsert(
  tableName: string,
  documents: any[],
  pgIds: string[],
): Promise<void> {
  const batchSize = TABLE_BATCH_SIZES[tableName] ?? BATCH_SIZE;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const batchPgIds = pgIds.slice(i, i + batchSize);

    try {
      const convexIds = await convex.mutation(api.migrations.batchInsert, {
        table: tableName,
        documents: batch,
      });

      for (let j = 0; j < batchPgIds.length; j++) {
        idMaps[tableName].set(batchPgIds[j], convexIds[j]);
      }
    } catch (err: any) {
      // If batch fails due to size, try inserting one at a time
      if (err.message?.includes('too large') || err.message?.includes('1 MiB')) {
        console.log(`    Batch too large, falling back to single-document insert...`);
        for (let j = 0; j < batch.length; j++) {
          const convexIds = await convex.mutation(api.migrations.batchInsert, {
            table: tableName,
            documents: [batch[j]],
          });
          idMaps[tableName].set(batchPgIds[j], convexIds[0]);
        }
      } else {
        throw err;
      }
    }

    if (documents.length > 100) {
      const done = Math.min(i + batchSize, documents.length);
      process.stdout.write(`\r  ${tableName}: ${done}/${documents.length}`);
    }
  }
  if (documents.length > 100) {
    process.stdout.write('\n');
  }
}

// ── Resume support: rebuild ID maps from already-migrated Convex data ──

async function rebuildIdMap(tableName: string): Promise<number> {
  let cursor: string | undefined = undefined;
  let total = 0;

  while (true) {
    const result = await convex.query(api.migrations.getPgIdMappingsPage, {
      table: tableName,
      cursor,
      pageSize: 4000,
    });

    for (const doc of result.items) {
      if (doc.pgId && doc._id) {
        idMaps[tableName].set(doc.pgId as string, doc._id as string);
      }
    }
    total += result.items.length;

    if (result.isDone) break;
    cursor = result.continueCursor as string;
  }

  return total;
}

// ── Payload sanitization for oversized documents ──

const MAX_ARRAY_LENGTH = 100; // Truncate arrays longer than this in payloads

function estimateJsonSize(obj: any): number {
  return JSON.stringify(obj).length;
}

/**
 * Recursively truncate large arrays (like rng_state with 625 ints) and
 * deeply nested objects to keep Convex documents under the 1MB limit.
 * Replaces arrays > MAX_ARRAY_LENGTH with a summary marker.
 */
function truncateLargePayload(obj: any, depth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) {
      return {
        __truncated: true,
        originalLength: obj.length,
        sample: obj.slice(0, 5),
      };
    }
    return obj.map((item) => truncateLargePayload(item, depth + 1));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = truncateLargePayload(value, depth + 1);
  }
  return result;
}

/**
 * Sanitize a document payload to fit within Convex's 1MB limit.
 * First tries the raw payload; if estimated size > 800KB, truncates large arrays.
 */
function sanitizePayload(payload: any): any {
  if (!payload) return payload;
  const size = estimateJsonSize(payload);
  if (size > 500_000) {
    console.log(`    Truncating oversized payload (${(size / 1024).toFixed(0)}KB)...`);
    return truncateLargePayload(payload);
  }
  return payload;
}

// ── Table migration functions ──

async function migrateUsers() {
  const rows = await sql`SELECT * FROM users ORDER BY created_at ASC`;
  console.log(`  users: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    email: r.email,
    name: r.name,
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('users', docs, pgIds);
}

async function migrateProjects() {
  const rows = await sql`SELECT * FROM projects ORDER BY created_at ASC`;
  console.log(`  projects: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    ownerId: resolveFkRequired('users', r.owner_id),
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('projects', docs, pgIds);
}

async function migrateAgents() {
  const rows = await sql`SELECT * FROM agents ORDER BY created_at ASC`;
  console.log(`  agents: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    projectId: resolveFkRequired('projects', r.project_id),
    name: r.name,
    status: r.status || 'idle',
    updatedAt: tsToMs(r.updated_at) || Date.now(),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('agents', docs, pgIds);
}

async function migrateTournaments() {
  const rows = await sql`SELECT * FROM tournaments ORDER BY created_at ASC`;
  console.log(`  tournaments: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    projectId: resolveFkRequired('projects', r.project_id),
    name: r.name,
    configJson: r.config_json || {},
    status: r.status || 'pending',
    ...(r.data_snapshot_id ? { dataSnapshotId: r.data_snapshot_id } : {}),
    agentCount: r.agent_count ?? 0,
    completedCount: r.completed_count ?? 0,
    ...(r.started_at ? { startedAt: tsToMs(r.started_at) } : {}),
    ...(r.completed_at ? { completedAt: tsToMs(r.completed_at) } : {}),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('tournaments', docs, pgIds);
}

async function migrateStrategyVersions() {
  const rows = await sql`SELECT * FROM strategy_versions ORDER BY created_at ASC`;
  console.log(`  strategyVersions: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    agentId: resolveFkRequired('agents', r.agent_id),
    version: r.version,
    sourceKind: r.source_kind,
    ...(r.strategy_md ? { strategyMd: r.strategy_md } : {}),
    ...(r.strategy_pine ? { strategyPine: r.strategy_pine } : {}),
    ...(r.strategy_py ? { strategyPy: r.strategy_py } : {}),
    ...(r.strategy_ir_json ? { strategyIrJson: r.strategy_ir_json } : {}),
    configJson: r.config_json || {},
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('strategyVersions', docs, pgIds);
}

async function migrateTournamentEntries() {
  const rows = await sql`SELECT * FROM tournament_entries ORDER BY created_at ASC`;
  console.log(`  tournamentEntries: ${rows.length} rows`);
  if (rows.length === 0) return;

  // Insert WITHOUT runId — runs haven't been migrated yet.
  // runId will be patched in patchTournamentEntryRunIds() after runs are migrated.
  const docs = rows.map((r) => ({
    pgId: r.id,
    tournamentId: resolveFkRequired('tournaments', r.tournament_id),
    agentId: resolveFkRequired('agents', r.agent_id),
    ...(r.final_rank !== null ? { finalRank: r.final_rank } : {}),
    status: r.status || 'pending',
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('tournamentEntries', docs, pgIds);
}

async function migrateRuns() {
  const rows = await sql`SELECT * FROM runs ORDER BY created_at ASC`;
  console.log(`  runs: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    agentId: resolveFkRequired('agents', r.agent_id),
    strategyVersionId: resolveFkRequired('strategyVersions', r.strategy_version_id),
    ...(r.tournament_id ? { tournamentId: resolveFk('tournaments', r.tournament_id) } : {}),
    ...(r.branch_id ? { branchId: r.branch_id } : {}),
    status: r.status || 'pending',
    runType: r.run_type || 'backtest',
    configJson: r.config_json || {},
    ...(r.metrics_json ? { metricsJson: r.metrics_json } : {}),
    totalBars: r.total_bars ?? 0,
    processedBars: r.processed_bars ?? 0,
    ...(r.started_at ? { startedAt: tsToMs(r.started_at) } : {}),
    ...(r.completed_at ? { completedAt: tsToMs(r.completed_at) } : {}),
    ...(r.error_message ? { errorMessage: r.error_message } : {}),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('runs', docs, pgIds);
}

async function migrateOrders() {
  let offset = 0;
  let totalMigrated = 0;
  while (true) {
    const rows = await sql`SELECT * FROM orders ORDER BY created_at ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    if (rows.length === 0) break;

    const docs = rows.map((r) => ({
      pgId: r.id,
      runId: resolveFkRequired('runs', r.run_id),
      symbol: r.symbol,
      side: r.side,
      orderType: r.order_type,
      quantity: numToFloatRequired(r.quantity),
      ...(r.limit_price !== null ? { limitPrice: numToFloat(r.limit_price) } : {}),
      ...(r.stop_price !== null ? { stopPrice: numToFloat(r.stop_price) } : {}),
      status: r.status || 'pending',
      ...(r.submitted_at_sim ? { submittedAtSim: tsToMs(r.submitted_at_sim) } : {}),
      ...(r.filled_at_sim ? { filledAtSim: tsToMs(r.filled_at_sim) } : {}),
      barIndex: r.bar_index ?? 0,
    }));
    const pgIds = rows.map((r) => r.id);
    await batchInsert('orders', docs, pgIds);
    totalMigrated += rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  orders: ${totalMigrated} rows`);
}

async function migratePositions() {
  const rows = await sql`SELECT * FROM positions`;
  console.log(`  positions: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    runId: resolveFkRequired('runs', r.run_id),
    symbol: r.symbol,
    quantity: numToFloatRequired(r.quantity),
    avgEntryPrice: numToFloatRequired(r.avg_entry_price),
    currentPrice: numToFloatRequired(r.current_price),
    unrealizedPnl: numToFloatRequired(r.unrealized_pnl),
    realizedPnl: numToFloatRequired(r.realized_pnl),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('positions', docs, pgIds);
}

async function migratePortfolioSnapshots() {
  let offset = 0;
  let totalMigrated = 0;
  while (true) {
    const rows = await sql`SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    if (rows.length === 0) break;

    const docs = rows.map((r) => ({
      pgId: r.id,
      runId: resolveFkRequired('runs', r.run_id),
      barIndex: r.bar_index ?? 0,
      ...(r.timestamp_simulated ? { timestampSimulated: tsToMs(r.timestamp_simulated) } : {}),
      cash: numToFloatRequired(r.cash),
      equity: numToFloatRequired(r.equity),
      positionsJson: r.positions_json || {},
      drawdown: numToFloatRequired(r.drawdown),
      highWaterMark: numToFloatRequired(r.high_water_mark),
    }));
    const pgIds = rows.map((r) => r.id);
    await batchInsert('portfolioSnapshots', docs, pgIds);
    totalMigrated += rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  portfolioSnapshots: ${totalMigrated} rows`);
}

async function migrateAgentEvents() {
  let offset = 0;
  let totalMigrated = 0;
  while (true) {
    const rows = await sql`SELECT * FROM agent_events ORDER BY created_at ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    if (rows.length === 0) break;

    const docs = rows.map((r) => ({
      pgId: r.id,
      runId: resolveFkRequired('runs', r.run_id),
      eventType: r.event_type,
      payload: sanitizePayload(r.payload || {}),
      ...(r.timestamp_simulated ? { timestampSimulated: tsToMs(r.timestamp_simulated) } : {}),
      ...(r.bar_index !== null ? { barIndex: r.bar_index } : {}),
    }));
    const pgIds = rows.map((r) => r.id);
    await batchInsert('agentEvents', docs, pgIds);
    totalMigrated += rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  agentEvents: ${totalMigrated} rows`);
}

async function migrateCheckpoints() {
  let offset = 0;
  let totalMigrated = 0;
  while (true) {
    const rows = await sql`SELECT * FROM checkpoints ORDER BY created_at ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    if (rows.length === 0) break;

    const docs = rows.map((r) => ({
      pgId: r.id,
      runId: resolveFkRequired('runs', r.run_id),
      barIndex: r.bar_index ?? 0,
      ...(r.timestamp_simulated ? { timestampSimulated: tsToMs(r.timestamp_simulated) } : {}),
      stateBlob: sanitizePayload(r.state_blob || {}),
    }));
    const pgIds = rows.map((r) => r.id);
    await batchInsert('checkpoints', docs, pgIds);
    totalMigrated += rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  checkpoints: ${totalMigrated} rows`);
}

async function migrateSoulVersions() {
  const rows = await sql`SELECT * FROM soul_versions ORDER BY created_at ASC`;
  console.log(`  soulVersions: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    agentId: resolveFkRequired('agents', r.agent_id),
    version: r.version,
    soulMd: r.soul_md,
    soulJson: r.soul_json || {},
    status: r.status || 'pending',
    ...(r.derived_from_run_id ? { derivedFromRunId: resolveFk('runs', r.derived_from_run_id) } : {}),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('soulVersions', docs, pgIds);
}

async function migrateFills() {
  let offset = 0;
  let totalMigrated = 0;
  while (true) {
    const rows = await sql`SELECT * FROM fills ORDER BY created_at ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    if (rows.length === 0) break;

    const docs = rows.map((r) => ({
      pgId: r.id,
      orderId: resolveFkRequired('orders', r.order_id),
      runId: resolveFkRequired('runs', r.run_id),
      fillPrice: numToFloatRequired(r.fill_price),
      fillQuantity: numToFloatRequired(r.fill_quantity),
      fee: numToFloatRequired(r.fee),
      slippage: numToFloatRequired(r.slippage),
      ...(r.filled_at_sim ? { filledAtSim: tsToMs(r.filled_at_sim) } : {}),
    }));
    const pgIds = rows.map((r) => r.id);
    await batchInsert('fills', docs, pgIds);
    totalMigrated += rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  fills: ${totalMigrated} rows`);
}

async function migrateLeaderboardEntries() {
  const rows = await sql`SELECT * FROM leaderboard_entries ORDER BY computed_at ASC`;
  console.log(`  leaderboardEntries: ${rows.length} rows`);
  if (rows.length === 0) return;

  const docs = rows.map((r) => ({
    pgId: r.id,
    tournamentId: resolveFkRequired('tournaments', r.tournament_id),
    agentId: resolveFkRequired('agents', r.agent_id),
    runId: resolveFkRequired('runs', r.run_id),
    rank: r.rank,
    ...(r.total_return !== null ? { totalReturn: numToFloat(r.total_return) } : {}),
    ...(r.sharpe_ratio !== null ? { sharpeRatio: numToFloat(r.sharpe_ratio) } : {}),
    ...(r.sortino_ratio !== null ? { sortinoRatio: numToFloat(r.sortino_ratio) } : {}),
    ...(r.max_drawdown !== null ? { maxDrawdown: numToFloat(r.max_drawdown) } : {}),
    ...(r.win_rate !== null ? { winRate: numToFloat(r.win_rate) } : {}),
    ...(r.profit_factor !== null ? { profitFactor: numToFloat(r.profit_factor) } : {}),
    ...(r.net_profit !== null ? { netProfit: numToFloat(r.net_profit) } : {}),
    ...(r.total_trades !== null ? { totalTrades: r.total_trades } : {}),
    metricsJson: r.metrics_json || {},
    computedAt: tsToMs(r.computed_at) || Date.now(),
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('leaderboardEntries', docs, pgIds);
}

async function migrateBranches() {
  const rows = await sql`SELECT * FROM branches ORDER BY created_at ASC`;
  console.log(`  branches: ${rows.length} rows (two-pass for self-ref)`);
  if (rows.length === 0) return;

  // First pass: insert without parentBranchId
  const docs = rows.map((r) => ({
    pgId: r.id,
    runId: resolveFkRequired('runs', r.run_id),
    parentCheckpointId: resolveFkRequired('checkpoints', r.parent_checkpoint_id),
    parentRunId: resolveFkRequired('runs', r.parent_run_id),
    changeSummary: r.change_summary,
    ...(r.rationale ? { rationale: r.rationale } : {}),
    creatorType: r.creator_type || 'user',
    overridesJson: r.overrides_json || {},
    ...(r.result_delta_json ? { resultDeltaJson: r.result_delta_json } : {}),
    status: r.status || 'pending',
  }));
  const pgIds = rows.map((r) => r.id);
  await batchInsert('branches', docs, pgIds);

  // Second pass: patch parentBranchId for self-referencing rows
  const selfRefRows = rows.filter((r) => r.parent_branch_id);
  if (selfRefRows.length > 0) {
    console.log(`  branches: patching ${selfRefRows.length} self-references`);
    for (const r of selfRefRows) {
      const convexId = idMaps.branches.get(r.id);
      const parentConvexId = idMaps.branches.get(r.parent_branch_id);
      if (convexId && parentConvexId) {
        await convex.mutation(api.migrations.patchDocument, {
          id: convexId,
          patch: { parentBranchId: parentConvexId },
        });
      }
    }
  }
}

// Now update tournamentEntries that reference runs (second pass)
async function patchTournamentEntryRunIds() {
  const rows = await sql`SELECT id, run_id FROM tournament_entries WHERE run_id IS NOT NULL`;
  if (rows.length === 0) return;
  console.log(`  tournamentEntries: patching ${rows.length} run references`);
  for (const r of rows) {
    const convexEntryId = idMaps.tournamentEntries.get(r.id);
    const convexRunId = idMaps.runs.get(r.run_id);
    if (convexEntryId && convexRunId) {
      await convex.mutation(api.migrations.patchDocument, {
        id: convexEntryId,
        patch: { runId: convexRunId },
      });
    }
  }
}

// ── Main migration flow ──

const RESUME_MODE = process.argv.includes('--resume');
const FRESH_MODE = process.argv.includes('--fresh');

async function clearAllTables() {
  const allTables = [
    'leaderboardEntries', 'tournamentEntries', 'branches', 'fills',
    'agentEvents', 'checkpoints', 'soulVersions', 'portfolioSnapshots',
    'positions', 'orders', 'runs', 'strategyVersions',
    'tournaments', 'agents', 'projects', 'users',
  ];
  console.log('Clearing ALL Convex tables...');
  for (const table of allTables) {
    let totalCleared = 0;
    const clearBatch = (['agentEvents', 'checkpoints', 'portfolioSnapshots'].includes(table)) ? 50 : 200;
    while (true) {
      const cleared = await convex.mutation(api.migrations.clearTableBatch, { table, batchSize: clearBatch });
      totalCleared += cleared;
      if (cleared === 0) break;
      process.stdout.write(`\r  ${table}: cleared ${totalCleared} docs`);
    }
    if (totalCleared > 0) process.stdout.write('\n');
  }
  console.log('All tables cleared.\n');
}

async function main() {
  console.log('=== PostgreSQL → Convex Migration ===\n');

  if (FRESH_MODE) {
    await clearAllTables();
  }

  if (RESUME_MODE) {
    console.log('RESUME MODE: Rebuilding ID maps from already-migrated data...\n');

    // Rebuild ID maps for tables that were already successfully migrated
    const alreadyMigrated = [
      'users', 'projects', 'agents', 'tournaments',
      'strategyVersions', 'tournamentEntries', 'runs',
      'orders', 'positions', 'portfolioSnapshots',
    ];

    for (const table of alreadyMigrated) {
      const count = await rebuildIdMap(table);
      console.log(`  ${table}: rebuilt ${count} ID mappings`);
    }

    // Clear tables that need re-migration
    const tablesToClear = [
      'agentEvents', 'checkpoints', 'soulVersions',
      'fills', 'leaderboardEntries', 'branches',
    ];
    console.log('\nClearing partially-migrated tables...');
    const clearBatchSizes: Record<string, number> = {
      agentEvents: 200,
      checkpoints: 100,
    };
    for (const table of tablesToClear) {
      let totalCleared = 0;
      const clearBatch = clearBatchSizes[table] ?? 200;
      while (true) {
        const cleared = await convex.mutation(api.migrations.clearTableBatch, { table, batchSize: clearBatch });
        totalCleared += cleared;
        if (cleared === 0) break;
        process.stdout.write(`\r  ${table}: cleared ${totalCleared} docs`);
      }
      if (totalCleared > 0) process.stdout.write('\n');
    }

    console.log('\nResuming migration from Level 5...\n');

    try {
      // Level 5
      console.log('Level 5: agentEvents, checkpoints, soulVersions');
      await migrateAgentEvents();
      await migrateCheckpoints();
      await migrateSoulVersions();

      // Level 6
      console.log('Level 6: fills, leaderboardEntries');
      await migrateFills();
      await migrateLeaderboardEntries();

      // Level 7
      console.log('Level 7: branches (with self-ref second pass)');
      await migrateBranches();

      console.log('\n=== Migration complete! ===');
      console.log('\nID mapping summary:');
      for (const [table, map] of Object.entries(idMaps)) {
        console.log(`  ${table}: ${map.size} records`);
      }
    } catch (error) {
      console.error('\n=== Migration FAILED ===');
      console.error(error);
      process.exit(1);
    } finally {
      await sql.end();
    }
  } else {
    console.log('Migrating in topological order...\n');

    try {
      // Level 0
      console.log('Level 0: users');
      await migrateUsers();

      // Level 1
      console.log('Level 1: projects');
      await migrateProjects();

      // Level 2
      console.log('Level 2: agents, tournaments');
      await migrateAgents();
      await migrateTournaments();

      // Level 3
      console.log('Level 3: strategyVersions, tournamentEntries (without run refs)');
      await migrateStrategyVersions();
      await migrateTournamentEntries();

      // Level 4
      console.log('Level 4: runs');
      await migrateRuns();

      // Patch tournament entries with run references
      await patchTournamentEntryRunIds();

      // Level 5
      console.log('Level 5: orders, positions, portfolioSnapshots, agentEvents, checkpoints, soulVersions');
      await migrateOrders();
      await migratePositions();
      await migratePortfolioSnapshots();
      await migrateAgentEvents();
      await migrateCheckpoints();
      await migrateSoulVersions();

      // Level 6
      console.log('Level 6: fills, leaderboardEntries');
      await migrateFills();
      await migrateLeaderboardEntries();

      // Level 7
      console.log('Level 7: branches (with self-ref second pass)');
      await migrateBranches();

      console.log('\n=== Migration complete! ===');
      console.log('\nID mapping summary:');
      for (const [table, map] of Object.entries(idMaps)) {
        console.log(`  ${table}: ${map.size} records`);
      }
    } catch (error) {
      console.error('\n=== Migration FAILED ===');
      console.error(error);
      process.exit(1);
    } finally {
      await sql.end();
    }
  }
}

main();
