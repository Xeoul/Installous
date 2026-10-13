#!/usr/bin/env bash
# Keeps one condor bot run alive through the close, so the bot trades even
# when GitHub skips scheduled runs (it skipped all of them on 2026-10-13).
# Any run that starts during the trading day steps the bot once right away
# (settling anything due), then sleeps until each time in TIMES (New York
# clock) and steps it again: a few times in the last half hour, where it
# opens the next condor, and once after the official close to settle.
# The bot itself decides what to do at each step; extra steps are harmless.
# A run that starts too early to reach the close (jobs are limited to six
# hours) waits as long as it can, then starts a fresh run of this workflow
# to take over (workflow_dispatch, which GitHub doesn't skip), so a single
# run starting any time from the morning on covers the whole day.
#
#   FUND_DIR     checkout of the fund-data branch holding condor.json
#   TIMES        space-separated HH:MM New York times (default below)
#   BUDGET_MIN   stop waiting after this many minutes (the job's limit is 360)
#   HANDOFF      when set, the command that starts the successor run
set -uo pipefail

TIMES=${TIMES:-"15:27 15:35 15:43 15:51 16:20"}
deadline=$(($(date +%s) + ${BUDGET_MIN:-330} * 60))

save() {
  (
    cd "$FUND_DIR" || exit 1
    git config user.name "github-actions[bot]"
    git config user.email "41898283+github-actions[bot]@users.noreply.github.com"
    git add condor.json
    git diff --cached --quiet && exit 0
    git commit -q -m "Update condor bot $(date -u +%Y-%m-%dT%H:%MZ)" || exit 1
    # The deploy workflow also pushes here (other files), so rebase onto it first.
    for _ in 1 2 3 4 5; do git pull -q --rebase && git push -q && exit 0; sleep 5; done
    exit 1
  )
}

step() {
  echo "::group::Step at $(TZ=America/New_York date '+%a %H:%M:%S %Z')"
  if npm run -s condor && save; then ok=0; else ok=1; echo "::warning::Condor step failed; the next step retries"; fi
  echo "::endgroup::"
  return $ok
}

step
status=$?

today=$(TZ=America/New_York date +%F)
[ "$(TZ=America/New_York date +%u)" -le 5 ] || exit $status
for t in $TIMES; do
  at=$(date -d "TZ=\"America/New_York\" $today $t" +%s)
  now=$(date +%s)
  [ "$at" -gt "$now" ] || continue
  if [ "$at" -gt "$deadline" ]; then
    if [ -n "${HANDOFF:-}" ]; then
      echo "Too early to wait for $t; handing off to a fresh run in $((deadline - now))s"
      [ "$deadline" -gt "$now" ] && sleep $((deadline - now))
      eval "$HANDOFF" || { echo "::error::Couldn't start the successor run"; exit 1; }
    else
      echo "Started too early to wait for $t; a later run takes over."
    fi
    break
  fi
  echo "Waiting until $t New York time ($((at - now))s)"
  sleep $((at - now))
  step
  status=$?
done
exit $status
