/** Dataset modules. Each exposes `QUESTIONS: Question[]` and `score(answer, expected) -> number in [0, 1]`. */

export interface Question {
  readonly id: string;
  readonly question: string;
  readonly expected: string;
}

export interface Dataset {
  readonly QUESTIONS: readonly Question[];
  score(answer: string, expected: string): number;
}
