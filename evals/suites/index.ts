/** Suite definitions: which datasets, with what weights and gates. */

export interface Suite {
  readonly name: string;
  /** dataset module name -> weight */
  readonly datasets: Readonly<Record<string, number>>;
  readonly repetitions: number;
  readonly minScore: number;
  readonly minDatasetAccuracy: number;
  readonly notes: string;
}
