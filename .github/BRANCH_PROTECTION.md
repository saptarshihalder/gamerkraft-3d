# Default-branch protection

Apply these rules to `main` in **Settings → Branches → Add branch protection rule** after the GitHub `origin` remote is configured:

- Require a pull request before merging and at least one approving review.
- Dismiss stale approvals when new commits are pushed.
- Require review from code owners.
- Require branches to be up to date before merging.
- Require these status checks: `Formatting and linting`, `Module tests`, `Build and package verification`, `Browser smoke tests`, and `dependency-review`.
- Require conversation resolution, signed commits if the organization policy requires it, and disallow force pushes and deletions.
- Include administrators, unless an emergency-maintenance policy explicitly permits bypasses.

Branch protection is an account-level GitHub setting. It cannot be committed into the repository; this document records the exact collaborative baseline to apply through GitHub Settings or the REST API with repository-admin credentials.
