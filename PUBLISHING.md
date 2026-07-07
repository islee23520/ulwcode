# Publishing Guide

This guide will help you publish the **ULW** extension to both the VS Code Marketplace and the OpenVSX Registry.

## Supported Marketplaces

- **VS Code Marketplace**: The official Microsoft marketplace for VS Code.
- **OpenVSX Registry**: An open-source alternative used by VSCodium, Eclipse Theia, Gitpod, etc.

## Automated Publishing (Recommended) ✅

The most reliable way to publish is using the built-in GitHub Actions workflow. This automatically publishes to **both** marketplaces whenever a new version tag is pushed.

### 1. Setup GitHub Secrets

You must add the following secrets to your GitHub repository (**Settings** → **Secrets and variables** → **Actions**):

| Secret Name  | Purpose                   | Where to Get                            |
| ------------ | ------------------------- | --------------------------------------- |
| `VSCE_PAT`   | VS Code Marketplace Token | [Azure DevOps](https://dev.azure.com)   |
| `OVSX_TOKEN` | OpenVSX Registry Token    | [OpenVSX Profile](https://open-vsx.org) |

#### How to get VSCE_PAT:

1. Go to [Azure DevOps](https://dev.azure.com).
2. Create a PAT with **Marketplace: Manage** scope (detailed in Manual Step 2 below).

#### How to get OVSX_TOKEN:

1. Sign in to [OpenVSX Registry](https://open-vsx.org) using GitHub/GitLab.
2. Go to your profile settings.
3. Generate and copy a new access token.

### 2. Trigger the Workflow

To publish a new version (e.g., `1.12.4`):

```bash
# Update version in package.json and create tag
npm version 1.12.4

# Push the tag to GitHub
git push origin v1.12.4
```

The workflow at `.github/workflows/publish.yml` will automatically build, package, and publish the extension to both marketplaces.

---

## Manual Publishing to VS Code Marketplace

### Step 1: Create Publisher Account

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your **Microsoft account**
3. If you don't have a publisher named "islee23520":
   - Click **"Create publisher"**
   - Fill in:
     - **Publisher ID**: `islee23520` (must match package.json)
     - **Display Name**: Your display name
     - **Email**: Your email address

### Step 2: Get Personal Access Token (PAT)

1. Go to https://dev.azure.com
2. Sign in with the **same Microsoft account**
3. Click your **profile icon** (top right) → **Personal access tokens**
4. Click **"+ New Token"**
5. Configure the token:
   - **Name**: `VS Code Extensions Publishing`
   - **Organization**: **All accessible organizations**
   - **Expiration**: Custom (recommended: 1 year)
   - **Scopes**:
     - Click **"Show all scopes"**
     - Expand **"Marketplace"**
     - Check **"Manage"** ✓
6. Click **"Create"**
7. **⚠️ IMPORTANT**: Copy the token immediately (you won't see it again!)

### Step 3: Login with vsce

Open terminal in the project directory and run:

```bash
npx @vscode/vsce login islee23520
```

When prompted, paste your Personal Access Token.

### Step 4: Publish the Extension

#### Option A: Publish Current Version (1.12.3)

```bash
npx @vscode/vsce publish
```

#### Option B: Publish and Increment Version

```bash
# Patch version (1.12.3 -> 1.12.4)
npx @vscode/vsce publish patch

# Minor version (1.12.3 -> 1.13.0)
npx @vscode/vsce publish minor

# Major version (1.12.3 -> 2.0.0)
npx @vscode/vsce publish major
```

### Step 5: Verify Publication

1. Wait 5-10 minutes for marketplace indexing
2. Visit: https://marketplace.visualstudio.com/items?itemName=islee23520.opencode-sidebar-tui
3. Search in VS Code: "ULW"

---

## Manual Publishing to OpenVSX Registry

If you need to publish to OpenVSX manually:

### Step 1: Create OpenVSX Account

1. Visit [open-vsx.org](https://open-vsx.org) and sign in (GitHub/GitLab/Google).
2. Go to your **Profile** → **Settings**.
3. Generate a new **Access Token**.

### Step 2: Install ovsx CLI

```bash
npm install -g ovsx
```

### Step 3: Publish

```bash
ovsx publish -p YOUR_OVSX_TOKEN
```

### Step 4: Verify

Visit: [https://open-vsx.org/extension/islee23520/opencode-sidebar-tui](https://open-vsx.org/extension/islee23520/opencode-sidebar-tui)

---

## Publishing Status

**Current Status**: 🚢 Ready for automated publishing
**Current Version**: 1.12.3

## Prerequisites Checklist

- ✅ Extension built and packaged
- ✅ Version: 1.12.3
- ✅ Publisher: islee23520
- ✅ Repository: https://github.com/islee23520/ulwcode.git
- ✅ License: MIT
- ✅ README: Comprehensive documentation

## Troubleshooting

### "Publisher not found"

- Ensure you created the publisher "islee23520" in Step 1
- Verify the publisher ID matches package.json exactly

### "Invalid PAT token"

- Generate a new token with "Marketplace: Manage" scope
- Ensure the token hasn't expired
- Make sure you're using the same Microsoft account

### "Version already exists"

- Use `--skip-duplicate` flag
- Or increment version: `vsce publish patch`

### "EACCES permission denied"

- Run with sudo: `sudo npx @vscode/vsce publish`
- Or fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally

## Future Updates

After initial publication, update the extension with:

```bash
# Update code, then:
npx @vscode/vsce publish patch  # For bug fixes
npx @vscode/vsce publish minor  # For new features
npx @vscode/vsce publish major  # For breaking changes
```

## Useful Commands

```bash
# Show what will be published
npx @vscode/vsce ls

# Package without publishing
npx @vscode/vsce package

# Show publisher info
npx @vscode/vsce show islee23520.opencode-sidebar-tui

# Unpublish (use carefully!)
npx @vscode/vsce unpublish islee23520.opencode-sidebar-tui
```

## Support

- Marketplace Publisher Portal: https://marketplace.visualstudio.com/manage
- VS Code Publishing Docs: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Azure DevOps: https://dev.azure.com

---

**Ready to publish?** Follow Steps 1-4 above, then run `npx @vscode/vsce publish`
