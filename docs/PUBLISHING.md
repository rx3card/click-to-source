# Publishing guide

This walks you through two separate things:

1. Putting the code on **GitHub** (so it has a home and a history).
2. Publishing the extension to the **VS Code Marketplace** (so anyone can install it).

They are independent. You can do GitHub now and the Marketplace later, or skip the
Marketplace entirely and just share the `.vsix` file by hand.

Before you start, open `package.json` and replace the placeholders:

- `"publisher"`: the id of your Marketplace publisher (you create it in step 2).
- `"author"`: your name.
- `"repository"`, `"bugs"`, `"homepage"`: your GitHub URLs.
- The copyright line in `LICENSE`.

---

## Part 1 - GitHub

### 1. Create the repository on GitHub

Go to github.com, click **New repository**, name it `click-to-source`, leave it empty
(no README, no license, no .gitignore - this project already has them), and create it.

### 2. Connect this folder and push

From the project folder, run:

```bash
git init
git add .
git commit -m "Initial release: Click to Source 0.1.0"
git branch -M main
git remote add origin https://github.com/your-username/click-to-source.git
git push -u origin main
```

That is the whole flow. After this, every change is just:

```bash
git add .
git commit -m "Describe what you changed"
git push
```

### 3. (Optional) Tag the release

A tag marks a point in history as "version 0.1.0". It is what GitHub Releases use.

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Part 2 - VS Code Marketplace

The Marketplace is run by Microsoft and built on top of Azure DevOps. The setup
feels heavier than it is - you do it once and never again.

### 1. Install the publishing tool

```bash
npm install -g @vscode/vsce
```

`vsce` ("Visual Studio Code Extensions") is the official command-line tool that
packages and uploads extensions.

### 2. Create an Azure DevOps organization

You need a free Azure DevOps account to get a token.

1. Go to https://dev.azure.com and sign in with a Microsoft account (any email works;
   create one if you don't have it).
2. Create an organization. The name does not matter - it is just a container.

### 3. Create a Personal Access Token (PAT)

This token is the password `vsce` uses to upload on your behalf.

1. In Azure DevOps, click your avatar (top right) -> **Personal access tokens**.
2. Click **New Token**.
3. Name it something like `vsce`.
4. Under **Organization**, choose **All accessible organizations** (important).
5. Set an expiration (one year is fine).
6. Under **Scopes**, click **Show all scopes**, find **Marketplace**, and check
   **Manage**.
7. Create it, and **copy the token now** - you cannot see it again later.

### 4. Create your publisher

A publisher is the name shown as the author of the extension on the Marketplace.

1. Go to https://marketplace.visualstudio.com/manage and sign in with the same
   Microsoft account.
2. Create a publisher. The **id** you choose here is what goes in `package.json`
   under `"publisher"`. Pick something short and stable - it cannot be changed later.

Now update `package.json` so `"publisher"` matches that id.

### 5. Log in and publish

```bash
vsce login your-publisher-id
# paste the PAT when asked

vsce publish
```

`vsce publish` compiles, packages, and uploads in one step. Within a few minutes the
extension appears on the Marketplace and is installable from inside VS Code.

To release a new version later, bump the version and publish again:

```bash
vsce publish patch   # 0.1.0 -> 0.1.1
vsce publish minor   # 0.1.0 -> 0.2.0
```

---

## Sharing without the Marketplace

If you just want to hand the extension to someone, package it and send the file:

```bash
vsce package
```

This produces a `click-to-source-0.1.0.vsix`. They install it with
**Extensions panel -> ... menu -> Install from VSIX**.

---

## A note on the icon

The Marketplace shows the image set by `"icon"` in `package.json` (currently
`assets/icon.png`). A 128x128 or 256x256 PNG is ideal. A larger image works too;
it just makes the package bigger.
