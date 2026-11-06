# ref-peek

Explains the PR, Ticket and Spec numbers a reply mentions, so you do not have to ask what `PR #52` is. Display only: the session file and what the model reads keep the original words. Unlisted, and its UI is Chinese-only for now.

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

Click `PR #52` in the fullscreen terminal and a bubble opens over the reply, right above the number's row. Click the same number or ` 收起 ` to close it, another number to switch, a number in another reply to move it there:

```
╭──────────────────────────────────────────╮
│ PR #52 积分兑换商品 · 待验收        收起 │
│ owner/repo                               │
│ 用户能用积分兑换商品，库存不足时不能下单 │
│ 做完后的变化                             │
│ · 商品页新增「积分兑换」按钮             │
│ · 积分不够时提示还差多少                 │
│ 关联 Ticket #41 积分兑换入口             │
╰──────────────────────────────────────────╯
PR #52（用户能用积分兑换商品，库存不足时不能下单）已经可以验收了。
```

A PR's bubble lists the tickets it closes (`关联 Ticket #41 …`), a Ticket's or Spec's the PRs that close it (`所属 PR #52 …`). Click a row and the bubble shows that item where it stands. Four rows at most, then `还有 N 个`. A row's title is the original title, cut to fit: no model call.

## Rules

- `PR #N`, `Ticket #N`, `Spec #N`, `Issue #N` and bare `#N` are matched by text, not by a model. Fenced code, indented code (four spaces after a blank line, outside a list item), inline code, existing links and URLs are left alone, and so is `owner/repo#N`. A number GitHub does not know stays as written.
- Every mention becomes a link; the note follows only the first mention of a ref in a block, and none follows a number already explained: one followed, after optional spaces, by `（`, `(`, `：`, `:`, `—` or `–`.
- A `*` or `**` span around a linked number loses its marks: after a link or a note, a closing mark followed by Chinese would show as written. The link is styled already.
- `haiku` writes the short title, the sentence and the changes in one call, from the title and body. Until that lands the note is the original title and the bubble says `生成中…`; if it fails the original title stays and the bubble says `暂无说明`. A failed generation is retried once per session. The sentence, and a title used as the note, lose their closing punctuation.
- Title, body and the model's reply are untrusted: the prompt frames them as data, and all of it loses its markup before it reaches a reply.
- Cached in the mod's store by repository and number. One `gh api graphql` call reads a ref and what relates to it. gh is asked about one ref at most every 10 minutes, and the model runs again only when `updated_at` changed. At most two fetches run at once.
- The repository is the one this session's Bash calls last touched (`--repo`, a GitHub URL, `gh api repos/o/r`, `git -C <path>`, `cd <path>`), else the session directory's `origin`. A repository named in a reply's text changes nothing. A block keeps the repository it was first drawn under.

## Where the bubble stands

A press names the link, not a cell. So an open bubble cuts its block in two after the unit holding the number (a paragraph, a list item, a whole table) and draws the two parts stacked, the bubble standing on the first: the engine's layout counts the rows down to that unit, and only the rows left inside it are estimated (the terminal's wrapping for a paragraph or list item, column widths for a table). The block goes back to one piece when the bubble closes.

- It sits above the number's row and scrolls with the reply. It paints over earlier messages; later ones paint over it, so it goes below the row only when the rows shown above cannot hold it and the block's own rows under the number hold more.
- At the viewport's top edge the engine holds an absolute Box on screen, so a short block scrolled there has its bubble over the number and cut by the messages under it. Scroll a little. A block's distance from the viewport top is not reported while its first row is shown, so that case stays above.
- A number mentioned twice in a block anchors to its first mention: the press does not say which one.
- A table too narrow for its columns is drawn as label rows; the rows left in it are then a rough estimate.

## Surfaces

Where clicks are reported (the fullscreen terminal) ref-peek draws an annotated block itself, because the engine's own row takes no link press; a block with nothing to annotate stays the engine's. On every other surface the engine's row is kept and receives the new text, so links open in the browser and no bubble opens: clicks need the fullscreen terminal.

The `ctrl+o` view shows the notes too: the engine raises the same render hook there and `AssistantMessage` has no `isExpanded` to tell it apart. The session file keeps the original text.

## Run

Name `plugins/ref-peek` in `CLAUDE_CODE_PLUGIN_DIRS`, then start a new session.

```
claude plugin validate --strict plugins/ref-peek
claude plugin test plugins/ref-peek
```
