/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentEvents from "../agentEvents.js";
import type * as agents from "../agents.js";
import type * as branches from "../branches.js";
import type * as checkpoints from "../checkpoints.js";
import type * as deleteService from "../deleteService.js";
import type * as fills from "../fills.js";
import type * as leaderboardEntries from "../leaderboardEntries.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as portfolioSnapshots from "../portfolioSnapshots.js";
import type * as positions from "../positions.js";
import type * as projects from "../projects.js";
import type * as runs from "../runs.js";
import type * as seed from "../seed.js";
import type * as soulVersions from "../soulVersions.js";
import type * as strategyVersions from "../strategyVersions.js";
import type * as tournamentEntries from "../tournamentEntries.js";
import type * as tournaments from "../tournaments.js";
import type * as users from "../users.js";
import type * as webhookHandlers from "../webhookHandlers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentEvents: typeof agentEvents;
  agents: typeof agents;
  branches: typeof branches;
  checkpoints: typeof checkpoints;
  deleteService: typeof deleteService;
  fills: typeof fills;
  leaderboardEntries: typeof leaderboardEntries;
  migrations: typeof migrations;
  orders: typeof orders;
  portfolioSnapshots: typeof portfolioSnapshots;
  positions: typeof positions;
  projects: typeof projects;
  runs: typeof runs;
  seed: typeof seed;
  soulVersions: typeof soulVersions;
  strategyVersions: typeof strategyVersions;
  tournamentEntries: typeof tournamentEntries;
  tournaments: typeof tournaments;
  users: typeof users;
  webhookHandlers: typeof webhookHandlers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
