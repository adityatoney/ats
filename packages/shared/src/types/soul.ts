export type SoulStatus = 'pending' | 'active' | 'rejected' | 'superseded';

export interface SoulVersion {
  id: string;
  agentId: string;
  version: number;
  soulMd: string;
  soulJson: SoulJson;
  status: SoulStatus;
  derivedFromRunId: string | null;
  createdAt: string;
}

export interface SoulJson {
  beliefs: string[];
  antiPatterns: string[];
  regimePreferences: string[];
  timingLessons: string[];
  confidenceBoundaries: Record<string, unknown>;
  playbooks: string[];
  scarTissue: string[];
  forbiddenMoves: string[];
}
