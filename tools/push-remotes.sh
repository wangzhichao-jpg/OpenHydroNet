#!/usr/bin/env bash
# Fast-forward-only push of main to GitHub (origin) and Gitee (gitee), then verify both remote heads.
# Exits non-zero unless both remotes end up at the local HEAD. Never forces.
set -euo pipefail
export GIT_TERMINAL_PROMPT=0
cd "$(git rev-parse --show-toplevel)"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "不在 main 分支" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "工作区有未提交改动" >&2; exit 1; }
head=$(git rev-parse HEAD)
for remote in origin gitee; do
  git fetch -q "$remote"
  git merge-base --is-ancestor "$remote/main" main || { echo "$remote/main 不是本地祖先，需要先 pull --ff-only" >&2; exit 1; }
  for attempt in 1 2 3; do
    if timeout 120 git push "$remote" main; then break; fi
    [ "$attempt" = 3 ] && { echo "$remote 推送三次失败" >&2; exit 1; }
    sleep 5
  done
  remote_head=$(timeout 60 git ls-remote "$remote" refs/heads/main | cut -f1)
  [ "$remote_head" = "$head" ] || { echo "$remote 远程 HEAD $remote_head ≠ 本地 $head" >&2; exit 1; }
  echo "$remote: ${head:0:7} 已核对"
done
