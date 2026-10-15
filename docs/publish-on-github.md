# Publish only the examples on GitHub

[Back to README](../README.md)

Publish this examples directory as its own repository. The marketplace application, database, credentials, and real user/resource data remain separate. These steps prepare and publish code; they do not deploy a marketplace or announce it to a community.

## Prepare the release

From the examples directory:

```sh
npm test
npm run pack
```

The pack command uses an explicit file allowlist and writes `../release/agent-exchange-examples.tar.gz`. Extract that archive into an empty directory outside the private application's Git repository, inspect its contents, and publish that directory. Do not initialize or push the whole `agent-market` folder.

Check before upload:

- The archive contains only examples, synthetic fixtures, tests, configuration placeholders, and documentation.
- `.env.local`, API keys, cookies, `.agent-market-runs`, databases, server source, private configuration, and user files are absent.
- README commands and links work from the extracted folder.
- Any example output is synthetic or explicitly illustrative.
- The supplied MIT code license has been reviewed and accepted by the repository owner before publication. A dataset's declared license does not itself license the whole repository.

Even when `.gitignore` is present, inspect the staged files. A previously tracked secret can still be committed.

## Choose the owner and visibility

Use your own GitHub account or an organization where you are authorized to publish. Choose a repository name, for example `agent-exchange-examples`. No owner or public repository is assumed by this package.

A public repository can be read, cloned, and copied by anyone. Start private if ownership, licensing, or the release contents still need review. The maintainer should make the visibility decision deliberately.

## Publish through GitHub

You can create an empty repository in GitHub's interface and upload the **extracted examples folder contents**. Avoid adding a second unrelated README. Alternatively, use Git locally from that extracted folder:

```sh
git init
git add .
git diff --cached --stat
git diff --cached
git commit -m "Add Agent Exchange integration examples"
git branch -M main
```

Then add the exact repository URL supplied by GitHub, replacing both placeholders:

```sh
git remote add origin https://github.com/YOUR_OWNER/YOUR_REPOSITORY.git
git push -u origin main
```

Authentication follows your own GitHub setup. Never embed an access token into that URL. These commands publish the prepared files; they do not invite users, send messages, or post promotional content.

## Suggested repository presentation

Description:

> Dependency-free Node.js examples for agent-to-agent data and tool transactions with virtual-credit budgets.

Suggested topics: `ai-agents`, `agent-marketplace`, `rest-api`, `nodejs`, `developer-tools`.

Keep the first-trade walkthrough prominent. If there is no hosted service, leave the repository's website field empty or point it to documentation; never advertise `127.0.0.1` as a public product URL. Add a demo video or reachable preview link only after it exists and has been reviewed.

Account credentials are not part of this repository. Operators supply test access privately. Test with a restricted, disposable buyer wallet before inviting external developers.

## After publication

Clone the repository into a fresh folder and follow the README. Confirm tests and packaging work without any private server files. A real first trade still requires separate access to a running marketplace; make that prerequisite clear when sharing the repository.

When receiving issues, ask for redacted status codes and reproduction steps. If a real key was published, revoke it at the platform and replace it; deleting a message or commit alone does not invalidate the key.
