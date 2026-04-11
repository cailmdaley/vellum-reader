`vellum/` is the operator-facing shell for the Vite migration.

It intentionally does not contain a live app anymore. Its package scripts forward to
`../vellum-next` so existing `cd vellum && npm run ...` workflows keep working while
the actual reader implementation lives in one place.
