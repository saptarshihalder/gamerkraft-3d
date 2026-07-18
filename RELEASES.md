# Releases

## Policy

Releases use Semantic Versioning. Maintain a `vMAJOR.MINOR.PATCH` Git tag and update `package.json` and `CHANGELOG.md` together. Release notes must summarize user-visible changes, migration or compatibility notes, and verification performed.

## Release checklist

1. Ensure the default branch is green for quality, dependency review, and Pages checks.
2. Select the next semantic version and update `package.json` and `CHANGELOG.md`.
3. Run `npm run format:check`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:smoke`.
4. Create an annotated `vMAJOR.MINOR.PATCH` tag and GitHub Release using the matching changelog section as release notes.
5. Confirm the generated-site deployment is successful.
