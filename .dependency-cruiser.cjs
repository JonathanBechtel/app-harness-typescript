// Structural import contracts (the import-linter of this repo). Every contract
// here traces to a named failure mode (docs/guides/programmatic-code-discipline.md
// §3). A contract written before the package holds code starts green and never
// regresses: that is the cheapest architectural guarantee available.
//
// `npm run lint.imports` (tasks.ts) runs `depcruise --config .dependency-cruiser.cjs app`.
const EDGE = '^app/(api|web|cli)/';

module.exports = {
  forbidden: [
    // Contract 1 — layering. HTTP edge -> services -> repositories -> models.
    // Routes must not reach past services; lower layers must not reach up.
    {
      name: 'layers-services-must-not-import-edge',
      severity: 'error',
      from: { path: '^app/services/' },
      to: { path: EDGE },
    },
    {
      name: 'layers-repositories-must-not-import-up',
      severity: 'error',
      from: { path: '^app/repositories/' },
      to: { path: '^app/(api|web|cli|services)/' },
    },
    {
      name: 'layers-models-must-not-import-up',
      severity: 'error',
      from: { path: '^app/models/' },
      to: { path: '^app/(api|web|cli|services|repositories)/' },
    },
    // Contract 2 — the domain vocabulary must not know how it is persisted or served.
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^app/domain/' },
      to: { path: '^app/(models|repositories|services|api|web|cli)/' },
    },
    // Contract 3 — routers go through services, never straight to a repository.
    {
      name: 'edge-must-not-import-repositories',
      severity: 'error',
      from: { path: '^app/(api|web)/' },
      to: { path: '^app/repositories/' },
    },
    // Contract 4 — nothing depends on the runtime-job entrypoints.
    {
      name: 'nothing-imports-cli',
      severity: 'error',
      from: { path: '^app/(api|web|services|repositories|models|domain|ai)/' },
      to: { path: '^app/cli/' },
    },
    // Contract 5 — the observability plane holds no business logic and imports none.
    // Type-only imports (e.g. the Settings type for a signature) are allowed.
    {
      name: 'observability-is-dependency-free',
      severity: 'error',
      from: { path: '^app/observability/' },
      to: { path: '^app/(?!observability/)', dependencyTypesNot: ['type-only'] },
    },
    // Contract 6 — the shipped package never depends on developer trees.
    {
      name: 'app-must-not-import-dev-trees',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^(scripts|tests|evals|docs|deploy)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
