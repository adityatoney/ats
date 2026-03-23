import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { pythonClient } from '../lib/python-client';

export type StrategyVersionRecord = {
  _id: string;
  sourceKind: string;
  strategyMd?: string;
  strategyPine?: string;
  strategyPy?: string;
  strategyIrJson?: any;
  configJson: any;
  [key: string]: any;
};

export type DeterministicSourceKind = 'pine' | 'markdown_yaml';

export async function compileDeterministicArtifacts(
  sourceKind: DeterministicSourceKind,
  source: string,
) {
  return pythonClient.compileStrategy({ sourceKind, source });
}

export function getDeterministicSource(strategy: Pick<
  StrategyVersionRecord,
  'sourceKind' | 'strategyMd' | 'strategyPine'
>): { sourceKind: DeterministicSourceKind; source: string } | null {
  if (strategy.sourceKind === 'pine' && strategy.strategyPine?.trim()) {
    return { sourceKind: 'pine', source: strategy.strategyPine };
  }
  if (strategy.sourceKind === 'markdown_yaml' && strategy.strategyMd?.trim()) {
    return { sourceKind: 'markdown_yaml', source: strategy.strategyMd };
  }
  return null;
}

export async function ensureDeterministicArtifacts(strategy: StrategyVersionRecord) {
  if (strategy.sourceKind === 'legacy_python') {
    return strategy;
  }

  if (strategy.strategyPy && strategy.strategyPine && strategy.strategyIrJson) {
    return strategy;
  }

  const source = getDeterministicSource(strategy);
  if (!source) {
    throw new Error(
      `Strategy ${strategy._id} is missing deterministic source content for ${strategy.sourceKind}`,
    );
  }

  const compiled = await compileDeterministicArtifacts(source.sourceKind, source.source);
  const updated = await convex.mutation(api.strategyVersions.update, {
    id: strategy._id as any,
    strategyPine: compiled.strategyPine,
    strategyPy: compiled.strategyPy,
    strategyIrJson: compiled.strategyIrJson,
  });

  return updated || strategy;
}
