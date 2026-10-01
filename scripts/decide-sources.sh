#!/usr/bin/env bash
# Decides which sources the scrape workflow runs and prints one `name=true|false` line per source.
# Usage: decide-sources.sh [requested-source] [date]
#   requested-source: bibit, kontan, kontan-full, makmur, bareksa, or all. Empty means "by the date".
#   date: any `date -d` value, to try a day other than today (UTC).
set -euo pipefail

requested="${1:-}"
weekday=$(date -u -d "${2:-now}" +%u)
day_of_month=$(date -u -d "${2:-now}" +%-d)

bibit=false
kontan=false
kontan_full=false
makmur=false
bareksa=false

case "$requested" in
  bibit) bibit=true ;;
  kontan) kontan=true ;;
  kontan-full) kontan_full=true ;;
  makmur) makmur=true ;;
  bareksa) bareksa=true ;;
  all) bibit=true; kontan=true; makmur=true; bareksa=true ;;
  "")
    # The run starts at 23:00 UTC, so Saturday here is Sunday morning in Jakarta.
    bibit=true

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

for output in bibit=$bibit kontan=$kontan kontan_full=$kontan_full makmur=$makmur bareksa=$bareksa; do
  echo "$output"
done
