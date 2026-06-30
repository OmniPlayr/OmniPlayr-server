# Security Impact Reports

Large or security-sensitive pull requests must include a security impact report in this folder.

Copy `REPORT_TEMPLATE.md`, place the copied file in this same `.github/security-reports/` folder, rename the copy using the required file name format, and fill it out before requesting review.

Never remove `README.md` or `REPORT_TEMPLATE.md`. Only remove old generated report files that do not belong to the current pull request.

Create one report file per completed review. If the report changes later, do not overwrite the old report. Add a new report file with the new completion date and the current version, then include it in the same pull request.

## When a Report Is Required

A report is required when a pull request changes either:

- More than 20 files, or
- More than 500 total lines added and deleted.

A report is also required for any change that touches authentication, permissions, plugin loading, update logic, secrets, user data, database migrations, file uploads, external network calls, or dependency execution.

## File Name Format

```text
report_date-branch-version.md
```

Use:

- `report_date`: the date when the report is fully completed, in `YYYY-MM-DD` format.
- `branch`: the PR branch name, with `/` replaced by `-`.
- `version`: the project version the branch is coming from.

Version sources:

- Backend changes: use `backend/config.json` `version`.
- Frontend changes: use `frontend/src/config/version.toml` `version.frontend.safeVersion`.
- Full-stack changes: include both, for example `backend-2026.6.2_frontend-2026.6.2-dev`.

Example:

```text
2026-06-16-feature-login-hardening-backend-2026.6.2_frontend-2026.6.2-dev.md
```

## Required Sections

Each report should include:

- PR title and branch name.
- Report completion date.
- Source version from the branch.
- Summary of the change.
- Files and systems reviewed.
- New or changed trust boundaries.
- Authentication and permission impact.
- Data storage, user data, and privacy impact.
- Dependency, plugin, and external service impact.
- Possible vulnerabilities introduced.
- Mitigations already implemented.
- Remaining risks or reviewer questions.
- Final reviewer sign-off section.
