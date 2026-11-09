#!/bin/sh
# Copies rows from the D1 database bound as DB to the Postgres database DATABASE_URL names.
#
#   DATABASE_URL=postgres://… sh copy-data.sh --remote users posts
#
# Name each table after the tables its foreign keys point at. Use --local for your local D1.
set -eu

where=$1
shift
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# D1's tables and rows, as SQL, loaded into a SQLite file of your own.
npx wrangler d1 export DB "$where" --output "$work/d1.sql"
sqlite3 "$work/d1.db" < "$work/d1.sql"

# Each table as CSV. sqlite3 quotes empty text and leaves NULL unquoted, as Postgres reads them.
for table in "$@"; do
  columns=$(sqlite3 "$work/d1.db" "SELECT group_concat(name, ', ') FROM pragma_table_info('$table')")
  sqlite3 -csv -header "$work/d1.db" "SELECT $columns FROM $table" > "$work/$table.csv"
  printf '%s\n' "\\copy $table ($columns) FROM '$work/$table.csv' WITH (FORMAT csv, HEADER true)" >> "$work/copy.sql"
done

# Every table in one transaction, so a failure copies nothing.
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 --quiet --file "$work/copy.sql"
