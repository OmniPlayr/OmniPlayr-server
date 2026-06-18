---
name: create-security-report
description: Create high-quality repository security impact reports. Use when Codex is asked to create, update, review, or prepare a security report, security impact report, risk report, or PR security assessment, especially for repos with `.github/security-reports/README.md` and `REPORT_TEMPLATE.md`.
---

# Create Security Report

## Workflow

Before writing a report, build context from the repository instead of filling the template generically.

1. Read the report instructions first:
   - `.github/security-reports/README.md`
   - `.github/security-reports/REPORT_TEMPLATE.md`

2. Identify the report target:
   - Current branch name.
   - PR title if available from the user, local Git metadata, GitHub context, or branch name.
   - Intended base branch, such as `main`, `master`, `dev`, or the PR target branch.
   - Report completion date.
   - Project version source required by the report README.

3. Compare against the base branch when possible:
   - Prefer the actual PR target branch if known.
   - If unknown, inspect likely base branches such as `main`, `master`, or `dev`.
   - Use `git merge-base` and `git diff --stat` / `git diff --name-only` to understand changed files.
   - If the base branch is missing locally, say so in the report and continue from local repository context.
   - Do not fetch from the network unless the user asks or the task requires up-to-date remote branch data.

4. Read project context:
   - `README.md` and any contribution, setup, deployment, or architecture docs.
   - Known issue files, issue templates, security policy files, TODO docs, changelogs, and release notes if present.
   - Dependency manifests and lockfiles.
   - Runtime/deployment files such as Dockerfiles, compose files, CI workflows, config defaults, and setup scripts.

5. Read security-sensitive code paths touched by the branch or relevant to the project:
   - Authentication, sessions, token handling, password handling, 2FA, OAuth, SSO.
   - Authorization, role checks, admin checks, permission gates, multi-user boundaries.
   - User data storage, exports, deletes, logs, privacy settings, account data, uploads.
   - Database migrations, schema changes, query construction, raw SQL.
   - File system access, path handling, archive extraction, uploads/downloads.
   - Plugin/module loading, dependency execution, package installation, subprocesses.
   - Update logic, self-update flows, webhooks, external network calls, registry access.
   - Secrets, certificates, environment variables, config writes, default credentials.
   - Frontend storage, auth headers, CORS, CSP, XSS-prone rendering, redirects.
   - CI/CD, release workflows, deployment permissions, Docker socket access.

## Report Quality

Write the report as a specific security assessment, not a checklist dump.

- Match every required section from the local template.
- Use the exact filename format and version sources from the report README.
- Name concrete files, modules, routes, tables, configs, services, and workflows reviewed.
- Separate confirmed behavior from inference. Use phrasing like "the reviewed code shows" or "reviewer attention is needed" when appropriate.
- Include both mitigations already present and remaining risks/questions.
- Call out known issues from README/docs/issues if they affect security or review scope.
- Avoid claiming a vulnerability is fixed unless the code path was inspected.
- Avoid inventing tests or scan results. If tests, audits, or branch comparisons were not run, say so.
- Keep the sign-off section pending unless an actual reviewer decision is provided.

## Branch Comparison Guidance

When comparing to the branch the PR is going into, focus on security-relevant changes rather than every changed line.

- Summarize changed files by area: backend, frontend, setup, database, plugins, CI, config, docs.
- Highlight additions to trust boundaries, privileges, persistence, network calls, dynamic execution, data exposure, or dependency trust.
- Check whether new endpoints or UI flows have matching auth checks.
- Check whether new storage fields or logs contain user data or secrets.
- Check whether new dependencies or plugins execute code, download artifacts, or expand supply-chain risk.
- If a branch has a large diff, prioritize files with security-sensitive names first, then route registries and entry points.

## Final Checks

Before finishing:

- Verify the report file exists in `.github/security-reports/`.
- Verify `README.md` and `REPORT_TEMPLATE.md` in that folder were not removed or overwritten.
- Verify the filename's date, branch, and version match the instructions.
- Run `git status --short` and mention only the files intentionally changed.
