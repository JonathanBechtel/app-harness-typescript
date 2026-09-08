# app/web — optional server-rendered pages

Present in every project; used only by projects that need a UI. API-only services leave it alone (the placeholder `/` route is harmless) or delete `routes.ts` and the `register(webRoutes)` line in `app/app.ts`.

- Nunjucks templates in `app/templates/`, every page extending `base.njk` (route-conventions R4). Static assets in `app/static/`; **no build step**, plain CSS + vanilla JS.
- Shared UI primitives (buttons, cards, pagination) live once in `static/css/main.css`; page-specific styles in their own kebab-case file loaded via `{% block extra_css %}`. Extend a component with a modifier class rather than re-declaring it.
- Page routes declare `schema.response: { 200: HtmlPage }` and return `reply.view('<page>.njk', context)`.
- Custom Nunjucks filters register in `templating.ts` so tests rendering a partial see the same environment.
- Verify UI changes visually: `npm run test.e2e` drives a real browser against a running server and saves screenshots under `tests/e2e/screenshots/`; read them.
