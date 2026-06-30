## Summary
Describe what this PR changes and why it is needed.

## Added
- 

## Changed
- 

## Fixed
- 

## Removed
- 

## Testing
- [ ] I tested the changed behaviour locally.
- [ ] I added or updated tests where needed.
- [ ] I checked that existing behaviour still works.

Describe the exact tests, commands, or manual checks you ran:

```text

```

## Affected Areas
Check every area touched by this PR.

- [ ] Backend
- [ ] Frontend
- [ ] Database / migrations
- [ ] Plugins
- [ ] Authentication / permissions
- [ ] Configuration
- [ ] Docker / setup
- [ ] Documentation
- [ ] Other: 

## Security and Vulnerability Review
Every PR must explain the security impact, even when the answer is "none".

- [ ] This PR does not affect security-sensitive behaviour.
- [ ] This PR affects security-sensitive behaviour and the impact is explained below.
- [ ] This PR is a large patch and includes a security impact report in `.github/security-reports/`.

Security impact explanation:

```text

```

### When a Security Impact Report Is Required
You must add a security impact report when this PR is not a small patch.

A PR is considered not small when it changes either:

- More than 20 files, or
- More than 500 total lines added and deleted.

Use `git diff --shortstat origin/main...HEAD` or the GitHub PR file summary to check this.

Also add a report for any PR that touches authentication, permissions, plugin loading, update logic, secrets, user data, database migrations, file uploads, external network calls, or dependency execution, even if it is below the file or line limit.

### Where to Put the Report
Create a Markdown file in:

```text
.github/security-reports/
```

Copy `.github/security-reports/REPORT_TEMPLATE.md`, place the copied file in the same `.github/security-reports/` folder, and rename the copy using the required file name format below.

Never remove `.github/security-reports/README.md` or `.github/security-reports/REPORT_TEMPLATE.md`. Only remove old generated report files that do not belong to this PR.

The file name must use this format:

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
.github/security-reports/2026-06-16-feature-login-hardening-backend-2026.6.2_frontend-2026.6.2-dev.md
```

Only write the report date once the report is complete. If the report needs updates later, create a new report file with the new completion date and the current version, and include that file in the same PR.

Security report included:

- [ ] Not required because this is a small patch and does not touch security-sensitive behaviour.
- [ ] Required and added at: 

## Security Impact Report Checklist
If a report is required, it must include:

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

## Reviewer Notes
List anything reviewers should focus on.

- 

## Final Checklist
- [ ] The PR title is clear.
- [ ] The description explains what changed and why.
- [ ] Tests or manual checks are documented.
- [ ] Security impact is documented.
- [ ] Required security impact reports are included.
