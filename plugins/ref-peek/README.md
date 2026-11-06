# ref-peek

Explains the PR, Ticket and Spec numbers a reply mentions, so you do not have to ask what `PR #52` is. Display only: the conversation, what the model reads and `ctrl+o` keep the original words. Unlisted, and its UI is Chinese-only for now.

> Requires Claude Code 2.1.318 or later and the GitHub CLI (`gh`) authenticated for the repo.

## What it does

Before:

```
PR #52 已经可以验收了。
```

After:

```
PR #52（用户能用积分兑换商品，库存不足时不能下单）已经可以验收了。
```

Click `PR #52` in the fullscreen terminal and a card opens above the prompt. Click the same number or ` 收起 ` to close it, another number to switch:

```
╭──────────────────────────────────────────╮
│ PR #52 积分兑换商品 · 待验收        收起 │
│ owner/repo                               │
│                                          │
│ 用户能用积分兑换商品，库存不足时不能下单 │
│                                          │
│ 做完后的变化                             │
│ · 商品页新增「积分兑换」按钮             │
│ · 积分不够时提示还差多少                 │
╰──────────────────────────────────────────╯
```

## Rules

- `PR #N`, `Ticket #N`, `Spec #N`, `Issue #N`, bare `#N` and `owner/repo#N` are matched by text, not by a model. Code blocks, inline code, existing links and URLs are left alone. A number GitHub does not know stays as written.
- Every mention becomes a link; the note follows only the first mention of a ref in a block, and none follows a number already explained (`（`, `(`).
- `haiku` writes the short title, the sentence and the changes in one call, from the title and body. Until that lands the note is the original title, and if it fails the original title stays and the card says `暂无说明`. A failed generation is retried once per session.
- Title, body and the model's reply are untrusted: the prompt frames them as data, and all of it loses its markup before it reaches a reply.
- Cached in the mod's store by repository and number. gh is asked about one ref at most every 10 minutes, and the model runs again only when `updated_at` changed. At most two fetches run at once.
- The repository comes from the block itself (a `github.com/o/r` URL, `o/r#N`), else the one this session's Bash calls last touched (`--repo`, a GitHub URL, `gh api repos/o/r`, `git -C <path>`, `cd <path>`), else the session directory's `origin`. A block keeps the repository it was first drawn under.

## Surfaces

Where clicks are reported (the fullscreen terminal) ref-peek draws an annotated block itself, because the engine's own row takes no link press; a block with nothing to annotate stays the engine's. On every other surface the engine's row is kept and receives the new text, so links open in the browser and no card opens.

## Run

Name `plugins/ref-peek` in `CLAUDE_CODE_PLUGIN_DIRS`, then start a new session.

```
claude plugin validate --strict plugins/ref-peek
claude plugin test plugins/ref-peek
```
