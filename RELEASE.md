# Release Instructions

This repository is configured to publish automatically to the npm registry via GitHub Actions whenever a new GitHub Release is created.

## How it Works
1. When you create a new Release on GitHub (from a `v*` tag), the **Publish** workflow is triggered.
2. The workflow builds the package, runs lints, and publishes it with cryptographic **provenance** using the `NPM_TOKEN` secret.

---

## Step-by-Step Release Guide

### 1. Verify Build
```powershell
npm run build; npm run lint
```

### 2. Bump Version & Create Tag
```bash
npm version patch    # 1.2.1 → 1.2.2
npm version minor    # 1.2.1 → 1.3.0
npm version major    # 1.2.1 → 2.0.0
```

### 3. Push to GitHub
```bash
git push origin main --follow-tags
```

### 4. Create GitHub Release
Go to GitHub → Releases → Create from the new tag → Actions auto-publishes.

---

## Notes for AI Assistants

1. Ensure all files are committed.
2. Run build/lint to verify.
3. Run `npm version <patch|minor|major>`.
4. Execute `git push origin main --follow-tags`.

## Manual Publish (Fallback)

See `npm_publishing_guide.txt` in workspace root for instructions.
