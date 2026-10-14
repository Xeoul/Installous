#!/usr/bin/env bash
# Keeps one condor bot run alive through the close, so the bot trades even
# when GitHub skips scheduled runs (it skipped all of them on 2026-10-13).
# Any run that starts during the trading day steps the bot once right away
# (settling anything due), then sleeps until each time in TIMES (New York
# clock) and steps it again: a few times in the last half hour, where it
# opens the next condor, and right after the official close to settle
# (16:06, with 16:20 as a retry).
# The bot itself decides what to do at each step; extra steps are harmless.
# Runs chain around the clock: jobs are limited to six hours, so each run
# waits as long as it can and then starts a fresh run of this workflow to
# take over (workflow_dispatch, which GitHub doesn't skip). One run started
# once keeps the bot going every day, weekends and holidays included, with
# no reliance on GitHub's schedule (which skipped every slot on 2026-10-13).
#
#   FUND_DIR     checkout of the fund-data branch holding condor.json
#   TIMES        space-separated HH:MM New York times (default below)
#   BUDGET_MIN   stop waiting after this many minutes (the job's limit is 360)
#   HANDOFF      when set, the command that starts the successor run
#   PUBLISH      when set, the command that republishes the site after new notifications
set -uo pipefail

TIMES=${TIMES:-"15:27 15:35 15:43 15:51 16:06 16:20"}
deadline=$(($(date +%s) + ${BUDGET_MIN:-330} * 60))

save() {
  (
    cd "$FUND_DIR" || exit 1
    git config user.name "github-actions[bot]"
    git config user.email "41898283+github-actions[bot]@users.noreply.github.com"
    git add condor.json
    [ -f notifications.json ] && git add notifications.json
    git diff --cached --quiet && exit 0
    news=$(git diff --cached --name-only -- notifications.json)
    git commit -q -m "Update condor bot $(date -u +%Y-%m-%dT%H:%MZ)" || exit 1
    # The deploy workflow also pushes here (other files), so rebase onto it first.
    for _ in 1 2 3 4 5; do
      if git pull -q --rebase && git push -q; then
        # New notifications: republish the site now, where the phone-notification routine reads them.
        [ -n "$news" ] && [ -n "${PUBLISH:-}" ] && { eval "$PUBLISH" || echo "::warning::Couldn't start the site deploy"; }
        exit 0
      fi
      sleep 5
    done
    exit 1
  )
}

step() {
  echo "::group::Step at $(TZ=America/New_York date '+%a %H:%M:%S %Z')"
  if npm run -s condor && save; then ok=0; else ok=1; echo "::warning::Condor step failed; the next step retries"; fi
  echo "::endgroup::"
  return $ok
}

# The next step time after `$1` (epoch seconds): today's remaining TIMES,
# else the first TIMES on the next weekday (New York calendar).
next_step() {
  local from=$1 off day t at
  for off in 0 1 2 3 4 5 6 7; do
    day=$(TZ=America/New_York date -d "@$((from + off * 86400))" +%F)
    [ "$(date -d "$day" +%u)" -le 5 ] || continue
    for t in $TIMES; do
      at=$(date -d "TZ=\"America/New_York\" $day $t" +%s)
      [ "$at" -gt "$from" ] && { echo "$at"; return; }
    done
  done
}

step
status=$?

while :; do
  now=$(date +%s)
  at=$(next_step "$now")
  if [ "$at" -gt "$deadline" ]; then
    if [ -n "${HANDOFF:-}" ]; then
      # Keep the chain going: wait as long as this job may, then start the next run.
      echo "Next step $(TZ=America/New_York date -d "@$at" '+%a %H:%M %Z') is past this run's limit; handing off in $((deadline - now))s"
      [ "$deadline" -gt "$now" ] && sleep $((deadline - now))
      eval "$HANDOFF" || { echo "::error::Couldn't start the successor run"; exit 1; }
    else
      echo "Next step $(TZ=America/New_York date -d "@$at" '+%a %H:%M %Z') is past this run's limit; a later run takes over."
    fi
    exit $status
  fi
  echo "Waiting until $(TZ=America/New_York date -d "@$at" '+%a %H:%M %Z') ($((at - now))s)"
  sleep $((at - now))
  step
  status=$?
done
