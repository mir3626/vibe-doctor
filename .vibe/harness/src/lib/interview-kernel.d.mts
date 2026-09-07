import type { SubFieldCoverage, DimensionCoverage, DimensionSpec } from './interview.js';
export function subFieldCoverageValue(value: SubFieldCoverage): number;
export function dimensionCoverageRatio(spec: DimensionSpec, coverage: DimensionCoverage): number;
export function computeAmbiguity(specs: DimensionSpec[], coverage: Record<string, DimensionCoverage>): number;
export function selectNextDimension(specs: DimensionSpec[], coverage: Record<string, DimensionCoverage>, recent: string[], options?: { thrashWindow?: number }): DimensionSpec | null;
export function shouldTerminate(ambiguity: number, round: number, max: number, specs: DimensionSpec[], coverage: Record<string, DimensionCoverage>): { terminate: boolean; reason: 'ambiguity' | 'max-rounds' | 'soft-terminate' | null };
