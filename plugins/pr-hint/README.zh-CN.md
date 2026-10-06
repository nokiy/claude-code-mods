# pr-hint

把当前分支的 PR 直接显示在输入框下方的提示行上，悬停提示行即可预览一张卡片（点 `PR #N` 前面的 `▸` 固定），显示交付进度（进度条、`Tickets d/n`、Spec）以及每张 ticket 的状态。

[English](README.md)

> 需要 Claude Code ≥ 2.1.287，以及已登录并对该仓库有权限的 GitHub CLI（`gh`）。

## 它做什么

当前会话所在分支有一个打开中的 PR（没有打开的就取已合并的那个）时，提示行（带 `bypass permissions on`、`accept edits on` 等的那一行）末尾会追加 PR 与它的状态，仍在同一行：

```
▸▸ bypass permissions on · PR #15 添加深色模式——设置页与编辑器 · Ready
```

状态是 PR 自己的，单票、多票交付一样：`Draft`（黄，施工中）→ `Ready`（品红，待验收）→ `Merged`（绿，已合并；只在分支仍停在被合并的那个提交上时显示，所以 `dev → main` 发版后又有新提交的 `dev` 不会挂着旧的 Merged）。三个词中英文界面都用英文。模式短语保持原来的颜色，PR 标题占满剩余宽度；行太窄时先去掉状态，再缩短标题。

悬停提示行，输入框上方显示卡片，鼠标移开即隐藏；点提示行上 `PR #N` 前面的 ` ▸ `（左右各补一格空白，共三格，好点中）固定常显（变成 `▾`），再点取消：

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 添加深色模式 ██████████░░░░░░░░░░ Tickets 2/4 · Spec #12  ↻ 刷新  │
│ ◐ 1 running                                                              │
│ ● #14 running 主题开关 · feat/14-theme-toggle · 还差 2 个提交            │
│ ● #16 not started 保存设置                                               │
│ ● #13 Merged 颜色命名 · feat/13-color-names                              │
│ ● #11 accepted 深色调色板                                                │
│ 打开 PR · 拉取于 2 分钟前                                                │
╰──────────────────────────────────────────────────────────────────────────╯
```

自上而下：两行头部、每张 ticket 一行（一张不漏）、PR 链接，以及 pr-hint 上次从 GitHub 拉取的时间（`拉取于`，页脚只留这一个时间）。头部第一行是 `PR #N`、PR 标题原文（放不下用 `…` 截断）、20 格宽的进度条（卡片窄时才缩，最少 10 格），紧跟其后的 `Tickets d/n`（`d` 是 Merged 或 accepted 的票数），PR 有 Spec 时再加 `Spec #N`；不显示 PR 状态词，也不显示百分比。第二行是进行中的票数：`◐ N running`。同时装了 [agent-monitor](../agent-monitor) 时，后面接上这个 PR 的子代理消耗 `≈$1.25 · 86.2k tokens · 12m34s (仅子代理)`（不含主会话；价格未知时不显示 `≈$`），hook 拒绝过它们的工具调用时再加 `拦截 ×N`；没装 agent-monitor，或它还没见过这个 PR 的子代理时，这一行只有 `◐ N running`。卡片右上角的 `↻ 刷新` 按钮可手动刷新（见「刷新」）。ticket 状态词中英文界面都用英文：`not started`、`running`、`Merged`、`accepted`。ticket 按 running、not started、Merged、accepted 排序。ticket 标题开头的 `[mod]` 范围标签（如 `[pr-hint] 编辑表单`）在卡片上不显示。

显示的 PR 始终属于会话所在的位置：**仓库根目录加分支**。在同一仓库内 `cd` 进子目录不受影响；`cd` 到别的仓库、`git checkout` 到别的分支，或在别处 `/clear`，旧 PR 立即隐藏并改读新位置的 PR（见「刷新」）。只认头分支在本仓库的 PR，同名分支的 fork PR 会被忽略。没有 PR，或只有已关闭（未合并）的 PR 时，面板和提示行保持 Claude Code 原样，唯独出现「← N agents」时例外：该标记被去掉，当帧提示行由文本重绘（有 PR 时是为腾位置而隐藏）。

## Spec 与 ticket

读取 PR 会关闭的 issue（GitHub 关联到它的那些，没有则取 PR 描述里的 `Closes #N`）。带 `spec` 标签的是 **Spec**，票号显示在卡片第一行末尾，不算 ticket；其余都是 **ticket**。

## ticket 状态怎么判定

看本地 git 分支加 PR 的提交标题（不执行 `git fetch`，不调用模型），自上而下取第一条命中的：

| 状态 | 规则 |
| --- | --- |
| accepted（绿点） | issue 已关闭，或其验收表（表头含 `State` 与 `Rounds`）全部为 ✓ |
| running | 该 ticket 的某个分支（`*/<N>-*` 或 `<N>-*`）就是 PR 的 head，或领先于它 |
| Merged | PR 里有提交标题点名该 ticket：`<type>(#N): …`、`<type>(<scope>): … (#N)`（快进合入只留下这种标题）、`<type>（<scope>）：… #N`（票号在标题末尾），或点名 `/N-` 分支的 `Merge …` 标题。仅分支已合入不算，`chore: 吸收 #N` 这类顺带提及也不算 |
| not started | 以上都不是 |

ticket 状态只给卡片上它自己那一行上色，提示行不再计数。`还差 N 个提交` 表示该 ticket 的分支比 PR head 多出的提交数。

## 刷新

分两档，各用一个定时器，互不重叠（遇到别的刷新还在跑就跳过这一拍）。20 秒档只在读到的 refs 变了才重绘；每次 gh 拉取都会重绘，因为 `拉取于` 时间会变。会话开始和每轮结束做一次全量刷新（PR、ticket、git 状态）；若此时已有一次全量刷新在跑，就等它结束并共用它的结果，不会再排一次。

| 间隔 | 读取 | 何时重算 ticket 状态 |
| --- | --- | --- |
| 20 秒 | 只读本地 git，不联网：仓库根目录、当前分支和 `git for-each-ref` | 分支或其提交与上次不同：本地合并、新提交、删除分支。仓库根或分支与上次拉取时（无论有无 PR）不同，就触发一次全量刷新，所以 `git checkout` 到有 PR 的分支 20 秒内就能看到，不必等 5 分钟 |
| 5 分钟 | 一次 `gh api graphql` 请求：PR（由 `gh` 按会话目录所在仓库与当前分支定位）、CI、提交，以及全部关闭的 issue | 每次（全量刷新） |

只有 PR 合入非默认分支（GitHub 不会关联 issue）时多一次请求：按编号读它 `Closes #N` 的 issue。想更早看到新数据？点按钮，或结束一轮对话。

拉取失败（gh 非零退出、超时、返回读不懂的内容或带 GraphQL 错误）不等于没有 PR：已显示的 PR 保留，`拉取于` 仍是旧时间。只有成功应答且确无打开的 PR、也无仍停在本分支提交上的已合并 PR 时才会清掉它。

**手动刷新：** 点卡片上的 ` ↻ 刷新 ` 做一次全量刷新（已有一次在跑就加入它；期间按钮显示 `刷新中…`，重复点击无效）。结束后用 toast 告知结果：`PR #23 已更新：Draft → Ready · CI ✓1/1`、`PR #23 已是最新`、`当前分支已没有 PR` 或 `拉取失败，稍后再试`，卡片收起了也会提示。页脚的 `拉取于` 是 GitHub 最近一次成功应答的时间，20 秒的 git 重算不更新它。

git 状态用 `git branch -a` 和 `git rev-list --count`；全部在会话目录下运行。

## 设置

打开 **/config** 选择 pr-hint。

| 设置 | 默认 | 含义 |
| --- | --- | --- |
| Language | `auto` | `auto` 先跟随 Claude Code 的语言设置，再看系统 locale；`en` 或 `zh` 强制指定。默认英文。 |

## 安装

在 Claude Code（2.1.287 或更高版本）中：

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install pr-hint@nokiy-mods
```

第一条命令把本仓库添加为插件市场（只需一次），第二条从中安装本 mod。装好后开一个新会话。

## 许可

MIT
