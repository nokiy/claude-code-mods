# pr-hint

把当前分支的 PR 直接显示在输入框下方的提示行上，悬停提示行即可预览一张卡片（点 `PR #N` 前面的 `▸` 固定），显示 Spec、集成分支，以及每张 ticket 的进度。

[English](README.md)

> 需要 Claude Code ≥ 2.1.287，以及已登录并对该仓库有权限的 GitHub CLI（`gh`）。

## 它做什么

当前会话所在分支有一个**打开中**的 PR 时，提示行（带 `bypass permissions on`、`accept edits on` 等的那一行）末尾会追加一段摘要，仍在同一行：

```
▸▸ bypass permissions on · PR #15 添加深色模式——设置页与编辑器 · 合入 2/4 · 验收 1/4
```

模式短语保持原来的颜色，PR 标题占满剩余宽度；行太窄时先去掉计数，再缩短标题。

悬停提示行，输入框上方显示卡片，鼠标移开即隐藏；点提示行上 `PR #N` 前面的 `▸` 固定常显（变成 `▾`），再点取消：

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 添加深色模式——设置页与编辑器                                      │
│ Spec #12 深色模式 · 集成分支 dev ← spec/12-dark-mode                     │
│ CI ✓3/3 · 合入 2/4 · 验收 1/4                                            │
│ ● #14 进行中 主题开关 · feat/14-theme-toggle · 还差 2 个提交             │
│ ● #16 未开始 保存设置                                                    │
│ ● #13 已合入 颜色命名 · feat/13-color-names                               │
│ ● #11 已验收 深色调色板                                                  │
│ 打开 PR · 更新于 5 分钟前                                                │
╰──────────────────────────────────────────────────────────────────────────╯
```

自上而下：PR 标题、Spec 与集成分支（`base ← head`）、CI 与计数、每张 ticket 一行（一张不漏）、PR 链接与更新时间。ticket 按 进行中、未开始、已合入、已验收 排序。CI 后面的 `↻N` 是还在运行的检查数。

没有 PR，或 PR 已合并 / 已关闭时，本 mod 什么都不做，提示行和面板保持 Claude Code 原样。

## Spec 与 ticket

读取 PR 会关闭的 issue（PR 描述里的 `Closes #N`）。带 `spec` 标签的是 **Spec**，单独一行显示，不计入任何计数；其余都是 **ticket**。

## ticket 状态怎么判定

只看本地 git（不执行 `git fetch`，不调用模型）：

| 状态 | 规则 |
| --- | --- |
| 未开始 | 不存在名为 `*/<N>-*`（或 `<N>-*`）的分支 |
| 进行中 | 该 ticket 的某个分支领先于 PR 的 head |
| 已合入 | 该 ticket 的所有分支都已合入 PR 的 head |
| 已验收（绿点） | issue 已关闭，或其验收表（表头含 `State` 与 `Rounds`）全部为 ✓ |

`合入 a/b` 统计已合入与已验收的 ticket，`验收 c/d` 只统计已验收的。`还差 N 个提交` 表示该 ticket 的分支比 PR head 多出的提交数。

## 刷新

会话开始和每轮结束时刷新全部（PR、ticket、git 状态），另有每 60 秒一次只刷新 PR。数据来自会话目录下的 `gh pr view`、`gh issue view`、`git branch -a` 和 `git rev-list --count`。

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
