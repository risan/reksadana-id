#!/usr/bin/env bash
# Decides which sources the scrape workflow runs and prints one `name=true|false` line per source.
# Usage: decide-sources.sh [requested-source] [date]
#   requested-source: bibit, kontan, kontan-full, makmur, bareksa, bareksa-profiles, or all. Empty means "by the date".
#   date: any `date -d` value, to try another moment than now (UTC).
set -euo pipefail

requested="${1:-}"
# The cron fires at 22:17 UTC, but GitHub can start a run hours late, even after midnight. A run before noon UTC
# belongs to the previous evening, so the day is taken 12 hours back.
run_day=$(date -u -d "$(date -u -d "${2:-now}" +%Y-%m-%dT%H:%M:%SZ) - 12 hours" +%Y-%m-%d)
weekday=$(date -u -d "$run_day" +%u)
day_of_month=$(date -u -d "$run_day" +%-d)

bibit=false
kontan=false
kontan_full=false
makmur=false
bareksa=false
bareksa_profiles=false

case "$requested" in
  bibit) bibit=true ;;
  kontan) kontan=true ;;
  kontan-full) kontan_full=true ;;
  makmur) makmur=true ;;
  bareksa) bareksa=true ;;
  bareksa-profiles) bareksa_profiles=true ;;
  all) bibit=true; kontan=true; makmur=true; bareksa=true; bareksa_profiles=true ;;
  "")
    # The run starts in the evening UTC, so Saturday here is Sunday morning in Jakarta.
    bibit=true
    bareksa_profiles=true

    if [ "$weekday" = 6 ]; then
      makmur=true

      if [ "$day_of_month" -le 7 ]; then
        kontan_full=true
      else
        kontan=true
      fi
    fi

    if [ "$day_of_month" = 1 ]; then
      bareksa=true
    fi
    ;;
  *)
    echo "Unknown source: $requested" >&2
    exit 1
    ;;
esac

for output in bibit=$bibit kontan=$kontan kontan_full=$kontan_full makmur=$makmur bareksa=$bareksa bareksa_profiles=$bareksa_profiles; do
  echo "$output"
done
