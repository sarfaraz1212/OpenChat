# 0008 — Multi-tenant RBAC/workspaces deferred

## Context

LobeHub's RBAC is real multi-tenant infrastructure: `rbac_roles`/`rbac_permissions`/`rbac_role_permissions`/`rbac_user_roles`, `workspaces`/`workspace_members`/`workspace_invitations`, and a polymorphic per-resource ACL (`resourcePermissions`) — all woven through 67+ server call sites as middleware (research/03 §6). Building this fully means team-invite flows, role-management UI, and workspace-scoped everything.

## Decision

Skip multi-tenancy for now. Single-tenant/personal deployment: there is exactly one implicit owner, no other members, no invite/role-management UI.

## Consequences

- The RBAC/workspace _tables_ can still be ported as inert schema (per 0002's "port the data model" default for portable subsystems) if a later phase wants them, but no phase in this plan builds the enforcement middleware or any UI for them.
- If multi-tenancy is wanted later, expect it to touch most server routes (matching what research found upstream) — it is not a bolt-on, budget accordingly whenever it's revisited.
- No phase in `MIGRATION_PLAN.md` currently includes workspace/team features; if that changes, this file should be updated (not silently contradicted) and a new phase inserted.
