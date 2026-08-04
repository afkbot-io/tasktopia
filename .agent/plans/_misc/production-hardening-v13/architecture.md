# Architecture

## Current boundary

`MEMBER` and `OWNER` both receive the same fixed MCP scopes; new tokens never expire. Plan cities is an unpaged array. Spatial backfill is one large transaction. Entity reconciliation is embedded in `WorldCanvas`.

## Target boundary

- Access role defines the maximum token scope set; token defines the least privilege within it.
- Existing null-expiry tokens remain compatible; all newly issued tokens have explicit expiry.
- Cursor is opaque base64url JSON `{createdAt,id}` and SQL ordering is `(created_at,id)`.
- Backfill progress is committed per bounded entity batch; final migration marker appears only after all families complete.
- Reconciler owns create/attach/dispose/signature mechanics; Pixi-specific drawing remains in `WorldCanvas`.

## Alternatives considered

- Replace `MEMBER` with `EDITOR`: rejected because it breaks stored rows and public contracts.
- Break `/api/plan/cities` response: rejected; additive paged endpoint is safer.
- Background incomplete backfill: rejected because chunk reads could silently miss entities.
- Full map rewrite: rejected in favor of tested extraction.

## Rollout and rollback

Schema changes are additive except a compatible `country_members` rebuild needed to widen CHECK. Existing roles/tokens retain meaning. Cursor endpoint is additive. Backfill progress can resume after restart. Rollback can keep new columns/tables unused without data loss.
