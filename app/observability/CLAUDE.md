# app/observability — ops plane

Correlation context (`bind`, `bindJobRun`), the pino root and `getLogger`, secret scrubbing, and the request-correlation plugin. Imports nothing from the rest of the app (type imports excepted). Add a credential to `app/config.ts` → add it to `SECRET_SETTING_FIELDS` in `scrubbing.ts` (a test enforces this).
