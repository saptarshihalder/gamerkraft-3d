# Contributing to GamerKraft 3D

Thanks for improving GamerKraft. This project welcomes bug reports, design discussion, documentation improvements, and focused pull requests.

## Local development

Use Node.js 22 or newer. The application has no runtime package installation step because browser libraries are vendored.

```bash
npm run format:check
npm run lint
npm test
npm run build
npm run test:smoke
```

Serve `dist/browser` after a build to inspect the production package. Do not commit `dist/`; CI creates it and GitHub Pages publishes only that generated directory.

## Pull requests

1. Start from the default branch and keep each pull request focused.
2. Add or update module tests for behavior changes.
3. Run the checks above and explain any skipped check in the pull request.
4. Use imperative, descriptive commit messages. Pull-request titles should follow Conventional Commits, for example `feat(editor): add selection outlines` or `fix(physics): clamp ladder descent`.
5. Request review from the owners automatically suggested by `CODEOWNERS`.

## Versioning and releases

GamerKraft follows [Semantic Versioning 2.0.0](https://semver.org/): patch releases fix compatible bugs, minor releases add backward-compatible functionality, and major releases may make breaking changes. See [RELEASES.md](RELEASES.md) for the release process and [CHANGELOG.md](CHANGELOG.md) for release notes.

## Reporting vulnerabilities

Please do not publish security-sensitive details in a public issue. Contact the maintainers privately through the repository security advisory flow.
