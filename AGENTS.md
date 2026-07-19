# Motion Memo

## Architecture

- Preserve the local-first flow: commit user actions to mobile SQLite before network work.
- Keep sync jobs persistent, retryable, and idempotent. Use stable client-generated IDs.
- Record one continuous AAC/M4A file per session. Do not reintroduce recorder rotation; iOS cannot reliably reactivate audio recording in the background.
- Upload audio directly from mobile to Vercel Blob using presigned PUT URLs; do not route full recordings through a Next.js request body.
- Keep API routes authenticated and scoped to the owning Clerk user. New session-specific routes must verify ownership.
- Keep server processing asynchronous and safe to re-run. Mobile foreground reconciliation must not require restarting completed server work.
- Keep shared domain types in `packages/schemas`; maintain compatible SQLite and Postgres representations when changing persisted session data.

## Conventions

- Use TypeScript with strict typing; use camelCase in application types and snake_case in database rows/API persistence.
- Follow existing status enums and state transitions instead of inventing ad hoc strings.
- Keep client/server transformations explicit at boundaries.
- Treat model output as untrusted: validate or safely handle malformed extraction data and do not overwrite user corrections.
- Preserve API idempotency for session creation, upload registration, processing, and retries.

## Generated and Local Files

- Do not edit `node_modules/`, `.next/`, `.expo/`, local `.env*` files, or generated iOS project files directly.
- Change Live Activity native output through `apps/mobile/plugins/withLiveActivity.js`, then regenerate the iOS project.
- Treat `recordings/`, `sources-markdown/`, `summary-markdown/`, and `summary-html/` as reference artifacts; do not overwrite them unless the task explicitly requires it.
- Update lockfiles only through the package manager when dependencies change.

## Validation

Run the checks relevant to changed code:

- `npm run typecheck`
- API changes: `npm run lint --workspace=apps/api` and `npm run build --workspace=apps/api`
- Mobile TypeScript changes: `cd apps/mobile && npx tsc --noEmit`
- Recording, background sync, upload, or Live Activity changes require device validation when available.

There is currently no repository-owned automated test suite.

## Definition of Done

- The local-first workflow and authentication boundaries remain intact.
- Schema, API, mobile, and shared types stay consistent.
- Relevant validation passes, or any environment-dependent limitation is reported.
- Documentation is updated when behavior, setup, or known limitations change.

## Common Mistakes

- Passing recording options only to the `expo-audio` recorder constructor; they must be passed to `prepareToRecordAsync`.
- Uploading recordings through Next.js instead of the presigned Blob path.
- Re-triggering extraction when the server is already processing or finished.
- Forgetting retry/restart behavior for sync jobs.
- Treating local review edits as remotely synchronized when no server update has occurred.
- Assuming `manual_upload` or `local_only` has server-generated content without implementing its explicit workflow.
