# V8 ↔ Media synchronization contract

## Canonical source

- Repository: `MraJJqq/Media`.
- Canonical six-system runtime: `V6/`.
- Current pinned Media commit: `c715eda42ff02511c3bcd7b3fcc35043e0074f90`.
- Exact source commit is pinned in `.media-source-sha`; it must be a Git **commit SHA**, not a branch name or tree SHA.
- The Pages workflow checks out that exact commit before copying the runtime and canonical asset collections into V8.

## Ownership and update sequence

1. Change any of the six system runtime files in `Media/V6/` first.
2. Commit the Media changes.
3. Update V8 `.media-source-sha` and `docs/MEDIA-SOURCE-COMMIT.md` to that exact Media commit.
4. Let the V8 Pages workflow synchronize, validate, test and deploy the pinned snapshot.
5. Do not patch generated V8 runtime copies directly. The next pinned Media synchronization will overwrite those copies.

## Version naming

- `V8` is the deployed website/repository identity.
- `V6` is the retained internal runtime baseline and compatibility namespace.
- V6-prefixed module paths, imports, IndexedDB database names and localStorage keys are intentionally retained to preserve existing imports and cached user state. Do not bulk-rename them as a branding cleanup.
- The only intentional source/runtime identity transformation performed by the Pages workflow is the page title from `VEGAS V6` to `VEGAS V8`; the six system behaviors and interfaces remain Media-derived.

## Scope boundary

The synchronized runtime contains exactly six page systems: K-line, shared viewport/gestures, rolling market cards, Logo/countdown, five-timeframe selector, and full-screen dynamic layout. Signal scanning and notification execution remain separate services and are not part of this runtime package.
