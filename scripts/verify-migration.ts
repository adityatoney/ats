#!/usr/bin/env npx tsx
/**
 * Post-migration verification script.
 *
 * Checks:
 * A. Row count match between Postgres and Convex
 * B. Referential integrity — every FK points to an existing document
 * C. Null handling — nullable Postgres fields correctly map to absent Convex fields
 * D. Data fidelity — spot-check values match
 *
 * Usage: npx tsx scripts/verify-migration.ts
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

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

// ══════════════════════════════════════════════════
// A. Row Count Verification
// ══════════════════════════════════════════════════

const TABLE_MAP: Record<string, string> = {
  users: 'users',
  projects: 'projects',
  agents: 'agents',
  strategy_versions: 'strategyVersions',
  soul_versions: 'soulVersions',
  runs: 'runs',
  orders: 'orders',
  fills: 'fills',
  positions: 'positions',
  portfolio_snapshots: 'portfolioSnapshots',
  agent_events: 'agentEvents',
  checkpoints: 'checkpoints',
  branches: 'branches',
  tournaments: 'tournaments',
  tournament_entries: 'tournamentEntries',
  leaderboard_entries: 'leaderboardEntries',
};

async function verifyRowCounts() {
  console.log('\n═══ A. Row Count Verification ═══\n');

  for (const [pgTable, convexTable] of Object.entries(TABLE_MAP)) {
    const [pgResult] = await sql`SELECT count(*)::int as count FROM ${sql(pgTable)}`;

    // Paginated count for large tables
    let convexCount = 0;
    let cursor: string | undefined = undefined;
    while (true) {
      const result = await convex.query(api.migrations.countTable, {
        table: convexTable,
        ...(cursor ? { cursor } : {}),
      });
      convexCount += result.count;
      if (result.isDone) break;
      cursor = result.continueCursor as string;
    }

    assert(
      pgResult.count === convexCount,
      `Row count ${pgTable}: PG=${pgResult.count}, Convex=${convexCount}`,
    );
    if (pgResult.count === convexCount) {
      console.log(`  ✓ ${pgTable}: ${pgResult.count} rows match`);
    }
  }
}

// ══════════════════════════════════════════════════
// B. Referential Integrity
// ══════════════════════════════════════════════════

// Tables with large documents need smaller page sizes for ref integrity checks
const REF_CHECK_PAGE_SIZES: Record<string, number> = {
  checkpoints: 20,
  agentEvents: 50,
  portfolioSnapshots: 100,
};

// Paginated helper to check all FK refs for a table
async function checkTableRefs(
  table: string,
  fields: Array<{ name: string; optional: boolean }>,
): Promise<string[]> {
  const allErrors: string[] = [];
  let cursor: string | undefined = undefined;
  let totalChecked = 0;
  const pageSize = REF_CHECK_PAGE_SIZES[table] ?? 500;

  while (true) {
    const result = await convex.query(api.migrations.verifyRefIntegrityPage, {
      table,
      fields,
      ...(cursor ? { cursor } : {}),
      pageSize,
    });
    allErrors.push(...result.errors);
    totalChecked += result.checked;
    if (result.isDone) break;
    cursor = result.continueCursor as string;
  }

  return allErrors;
}

async function verifyReferentialIntegrity() {
  console.log('\n═══ B. Referential Integrity ═══\n');

  const FK_CHECKS: Array<{ table: string; fields: Array<{ name: string; optional: boolean }> }> = [
    { table: 'projects', fields: [{ name: 'ownerId', optional: false }] },
    { table: 'agents', fields: [{ name: 'projectId', optional: false }] },
    { table: 'strategyVersions', fields: [{ name: 'agentId', optional: false }] },
    { table: 'soulVersions', fields: [{ name: 'agentId', optional: false }, { name: 'derivedFromRunId', optional: true }] },
    { table: 'runs', fields: [{ name: 'agentId', optional: false }, { name: 'strategyVersionId', optional: false }, { name: 'tournamentId', optional: true }] },
    { table: 'orders', fields: [{ name: 'runId', optional: false }] },
    { table: 'fills', fields: [{ name: 'orderId', optional: false }, { name: 'runId', optional: false }] },
    { table: 'positions', fields: [{ name: 'runId', optional: false }] },
    { table: 'portfolioSnapshots', fields: [{ name: 'runId', optional: false }] },
    { table: 'agentEvents', fields: [{ name: 'runId', optional: false }] },
    { table: 'checkpoints', fields: [{ name: 'runId', optional: false }] },
    { table: 'branches', fields: [{ name: 'runId', optional: false }, { name: 'parentCheckpointId', optional: false }, { name: 'parentBranchId', optional: true }, { name: 'parentRunId', optional: false }] },
    { table: 'tournaments', fields: [{ name: 'projectId', optional: false }] },
    { table: 'tournamentEntries', fields: [{ name: 'tournamentId', optional: false }, { name: 'agentId', optional: false }, { name: 'runId', optional: true }] },
    { table: 'leaderboardEntries', fields: [{ name: 'tournamentId', optional: false }, { name: 'agentId', optional: false }, { name: 'runId', optional: false }] },
  ];

  let totalErrors = 0;
  let totalRelationships = 0;

  for (const { table, fields } of FK_CHECKS) {
    totalRelationships += fields.length;
    const errors = await checkTableRefs(table, fields);
    totalErrors += errors.length;

    if (errors.length > 0) {
      for (const e of errors.slice(0, 5)) {
        console.log(`    - ${e}`);
      }
      if (errors.length > 5) console.log(`    ... and ${errors.length - 5} more`);
    }

    const fieldNames = fields.map((f) => f.name).join(', ');
    assert(errors.length === 0, `${table} FK integrity (${fieldNames}): ${errors.length} errors`);
    if (errors.length === 0) {
      console.log(`  ✓ ${table}: ${fieldNames} — all valid`);
    }
  }

  console.log(`  (${totalRelationships} FK relationships verified)`);
}

// ══════════════════════════════════════════════════
// C. Null Handling Verification
// ══════════════════════════════════════════════════

const NULLABLE_FIELDS: Array<{ pgTable: string; pgColumn: string; convexTable: string; convexField: string }> = [
  { pgTable: 'projects', pgColumn: 'description', convexTable: 'projects', convexField: 'description' },
  { pgTable: 'runs', pgColumn: 'tournament_id', convexTable: 'runs', convexField: 'tournamentId' },
  { pgTable: 'runs', pgColumn: 'metrics_json', convexTable: 'runs', convexField: 'metricsJson' },
  { pgTable: 'runs', pgColumn: 'started_at', convexTable: 'runs', convexField: 'startedAt' },
  { pgTable: 'runs', pgColumn: 'completed_at', convexTable: 'runs', convexField: 'completedAt' },
  { pgTable: 'runs', pgColumn: 'error_message', convexTable: 'runs', convexField: 'errorMessage' },
  { pgTable: 'orders', pgColumn: 'limit_price', convexTable: 'orders', convexField: 'limitPrice' },
  { pgTable: 'orders', pgColumn: 'stop_price', convexTable: 'orders', convexField: 'stopPrice' },
  { pgTable: 'orders', pgColumn: 'submitted_at_sim', convexTable: 'orders', convexField: 'submittedAtSim' },
  { pgTable: 'orders', pgColumn: 'filled_at_sim', convexTable: 'orders', convexField: 'filledAtSim' },
  { pgTable: 'fills', pgColumn: 'filled_at_sim', convexTable: 'fills', convexField: 'filledAtSim' },
  { pgTable: 'soul_versions', pgColumn: 'derived_from_run_id', convexTable: 'soulVersions', convexField: 'derivedFromRunId' },
  { pgTable: 'branches', pgColumn: 'parent_branch_id', convexTable: 'branches', convexField: 'parentBranchId' },
  { pgTable: 'branches', pgColumn: 'rationale', convexTable: 'branches', convexField: 'rationale' },
  { pgTable: 'branches', pgColumn: 'result_delta_json', convexTable: 'branches', convexField: 'resultDeltaJson' },
  { pgTable: 'tournaments', pgColumn: 'data_snapshot_id', convexTable: 'tournaments', convexField: 'dataSnapshotId' },
  { pgTable: 'tournaments', pgColumn: 'started_at', convexTable: 'tournaments', convexField: 'startedAt' },
  { pgTable: 'tournaments', pgColumn: 'completed_at', convexTable: 'tournaments', convexField: 'completedAt' },
  { pgTable: 'tournament_entries', pgColumn: 'run_id', convexTable: 'tournamentEntries', convexField: 'runId' },
  { pgTable: 'tournament_entries', pgColumn: 'final_rank', convexTable: 'tournamentEntries', convexField: 'finalRank' },
  { pgTable: 'strategy_versions', pgColumn: 'strategy_md', convexTable: 'strategyVersions', convexField: 'strategyMd' },
  { pgTable: 'strategy_versions', pgColumn: 'strategy_pine', convexTable: 'strategyVersions', convexField: 'strategyPine' },
  { pgTable: 'strategy_versions', pgColumn: 'strategy_py', convexTable: 'strategyVersions', convexField: 'strategyPy' },
  { pgTable: 'strategy_versions', pgColumn: 'strategy_ir_json', convexTable: 'strategyVersions', convexField: 'strategyIrJson' },
];

async function verifyNullHandling() {
  console.log('\n═══ C. Null Handling Verification ═══\n');

  for (const { pgTable, pgColumn, convexTable, convexField } of NULLABLE_FIELDS) {
    const [pgResult] = await sql`
      SELECT count(*)::int as count FROM ${sql(pgTable)} WHERE ${sql(pgColumn)} IS NULL
    `;
    // Paginated count of missing fields
    let convexNullCount = 0;
    let nullCursor: string | undefined = undefined;
    while (true) {
      const nullPageSize = REF_CHECK_PAGE_SIZES[convexTable] ?? 2000;
      const result = await convex.query(api.migrations.countMissingFieldPage, {
        table: convexTable,
        field: convexField,
        ...(nullCursor ? { cursor: nullCursor } : {}),
        pageSize: nullPageSize,
      });
      convexNullCount += result.missing;
      if (result.isDone) break;
      nullCursor = result.continueCursor as string;
    }

    assert(
      pgResult.count === convexNullCount,
      `Null count ${pgTable}.${pgColumn}: PG=${pgResult.count}, Convex=${convexNullCount}`,
    );
    if (pgResult.count === convexNullCount) {
      console.log(`  ✓ ${pgTable}.${pgColumn}: ${pgResult.count} nulls match`);
    }
  }
}

// ══════════════════════════════════════════════════
// D. Data Fidelity Spot Checks
// ══════════════════════════════════════════════════

async function verifyDataFidelity() {
  console.log('\n═══ D. Data Fidelity Spot Checks ═══\n');

  // Spot check users
  const sampleUsers = await sql`SELECT * FROM users ORDER BY created_at ASC LIMIT 10`;
  for (const pgUser of sampleUsers) {
    const convexUser = await convex.query(api.migrations.getByPgId, { table: 'users', pgId: pgUser.id });
    assert(convexUser !== null, `User ${pgUser.id} exists in Convex`);
    if (convexUser) {
      assert(convexUser.email === pgUser.email, `User ${pgUser.id} email matches`);
      assert(convexUser.name === pgUser.name, `User ${pgUser.id} name matches`);
    }
  }
  console.log(`  ✓ Users spot check: ${sampleUsers.length} records`);

  // Spot check agents
  const sampleAgents = await sql`SELECT * FROM agents ORDER BY created_at ASC LIMIT 10`;
  for (const pgAgent of sampleAgents) {
    const convexAgent = await convex.query(api.migrations.getByPgId, { table: 'agents', pgId: pgAgent.id });
    assert(convexAgent !== null, `Agent ${pgAgent.id} exists in Convex`);
    if (convexAgent) {
      assert(convexAgent.name === pgAgent.name, `Agent ${pgAgent.id} name matches`);
      assert(convexAgent.status === pgAgent.status, `Agent ${pgAgent.id} status matches`);
    }
  }
  console.log(`  ✓ Agents spot check: ${sampleAgents.length} records`);

  // Spot check runs
  const sampleRuns = await sql`SELECT * FROM runs ORDER BY created_at ASC LIMIT 10`;
  for (const pgRun of sampleRuns) {
    const convexRun = await convex.query(api.migrations.getByPgId, { table: 'runs', pgId: pgRun.id });
    assert(convexRun !== null, `Run ${pgRun.id} exists in Convex`);
    if (convexRun) {
      assert(convexRun.status === pgRun.status, `Run ${pgRun.id} status matches`);
      assert(convexRun.runType === pgRun.run_type, `Run ${pgRun.id} runType matches`);
      assert(convexRun.totalBars === pgRun.total_bars, `Run ${pgRun.id} totalBars matches`);
      assert(convexRun.processedBars === pgRun.processed_bars, `Run ${pgRun.id} processedBars matches`);
      if (pgRun.started_at) {
        const pgMs = new Date(pgRun.started_at).getTime();
        assert(
          Math.abs((convexRun.startedAt || 0) - pgMs) < 1000,
          `Run ${pgRun.id} startedAt within 1s tolerance`,
        );
      }
    }
  }
  console.log(`  ✓ Runs spot check: ${sampleRuns.length} records`);

  // Spot check strategy versions
  const sampleSV = await sql`SELECT * FROM strategy_versions ORDER BY created_at ASC LIMIT 10`;
  for (const pgSv of sampleSV) {
    const convexSv = await convex.query(api.migrations.getByPgId, { table: 'strategyVersions', pgId: pgSv.id });
    assert(convexSv !== null, `StrategyVersion ${pgSv.id} exists in Convex`);
    if (convexSv) {
      assert(convexSv.version === pgSv.version, `StrategyVersion ${pgSv.id} version matches`);
      assert(convexSv.sourceKind === pgSv.source_kind, `StrategyVersion ${pgSv.id} sourceKind matches`);
      if (pgSv.strategy_py) {
        assert(convexSv.strategyPy === pgSv.strategy_py, `StrategyVersion ${pgSv.id} strategyPy matches`);
      }
    }
  }
  console.log(`  ✓ Strategy versions spot check: ${sampleSV.length} records`);

  // Spot check orders (financial precision)
  const sampleOrders = await sql`SELECT * FROM orders ORDER BY created_at ASC LIMIT 10`;
  for (const pgOrder of sampleOrders) {
    const convexOrder = await convex.query(api.migrations.getByPgId, { table: 'orders', pgId: pgOrder.id });
    assert(convexOrder !== null, `Order ${pgOrder.id} exists in Convex`);
    if (convexOrder) {
      const pgQty = parseFloat(pgOrder.quantity);
      assert(
        Math.abs(convexOrder.quantity - pgQty) < 1e-8,
        `Order ${pgOrder.id} quantity matches (PG=${pgQty}, Convex=${convexOrder.quantity})`,
      );
      assert(convexOrder.symbol === pgOrder.symbol, `Order ${pgOrder.id} symbol matches`);
      assert(convexOrder.side === pgOrder.side, `Order ${pgOrder.id} side matches`);
      assert(convexOrder.status === pgOrder.status, `Order ${pgOrder.id} status matches`);
    }
  }
  console.log(`  ✓ Orders spot check: ${sampleOrders.length} records`);

  // Spot check fills (financial precision)
  const sampleFills = await sql`SELECT * FROM fills ORDER BY created_at ASC LIMIT 10`;
  for (const pgFill of sampleFills) {
    const convexFill = await convex.query(api.migrations.getByPgId, { table: 'fills', pgId: pgFill.id });
    assert(convexFill !== null, `Fill ${pgFill.id} exists in Convex`);
    if (convexFill) {
      const pgPrice = parseFloat(pgFill.fill_price);
      const pgQty = parseFloat(pgFill.fill_quantity);
      const pgFee = parseFloat(pgFill.fee);
      assert(
        Math.abs(convexFill.fillPrice - pgPrice) < 1e-8,
        `Fill ${pgFill.id} fillPrice matches`,
      );
      assert(
        Math.abs(convexFill.fillQuantity - pgQty) < 1e-8,
        `Fill ${pgFill.id} fillQuantity matches`,
      );
      assert(
        Math.abs(convexFill.fee - pgFee) < 1e-8,
        `Fill ${pgFill.id} fee matches`,
      );
    }
  }
  console.log(`  ✓ Fills spot check: ${sampleFills.length} records`);
}

// ── Main ──

async function main() {
  console.log('=== Post-Migration Verification ===');

  try {
    await verifyRowCounts();
    await verifyReferentialIntegrity();
    await verifyNullHandling();
    await verifyDataFidelity();

    console.log('\n═══════════════════════════════════');
    console.log(`Total: ${totalTests} tests, ${passed} passed, ${failed} failed`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      for (const f of failures) {
        console.log(`  ✗ ${f}`);
      }
      console.log('\n=== VERIFICATION FAILED ===');
      process.exit(1);
    } else {
      console.log('\n=== ALL TESTS PASSED ===');
    }
  } catch (error) {
    console.error('\nVerification script error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
