export interface SubFieldCoverage {
  value: string;
  confidence: number;
  deferred: boolean;
}

export interface DimensionCoverage {
  ratio: number;
  subFields: Record<string, SubFieldCoverage>;
}

export interface DimensionSpec {
  id: string;
  label: string;
  weight: number;
  subFields: string[];
  required: boolean;
}

import { selectNextDimension as selectDimension } from './interview-kernel.mjs';
export { subFieldCoverageValue, dimensionCoverageRatio, computeAmbiguity, shouldTerminate } from './interview-kernel.mjs';
export function selectNextDimension(specs: DimensionSpec[], coverage: Record<string, DimensionCoverage>, recentDimensionIds: string[], options: { thrashWindow?: number } = {}): string {
  return selectDimension(specs, coverage, recentDimensionIds, options)?.id ?? '';
}
