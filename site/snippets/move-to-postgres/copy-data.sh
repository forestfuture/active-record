#!/bin/sh
# Copies rows from the D1 database bound as DB to the Postgres database DATABASE_URL names.
#
#   DATABASE_URL=postgres://… sh copy-data.sh --remote users posts
#
# Name each table after the tables its foreign keys point at. Use --local for your local D1.
set -eu

fail() {
  echo "copy-data.sh: $1" >&2
  exit 1
}

d1=$1 # --remote or --local
shift
# Names go into SQL, so each must be letters, digits and underscores.
for table in "$@"; do
  case $table in
    "" | [0-9]* | *[!A-Za-z0-9_]*) fail "can't copy a table named '$table'" ;;
  esac
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# D1's tables and rows, as SQL, loaded into a SQLite file of your own.
npx wrangler d1 export DB "$d1" --output "$work/d1.sql"
sqlite3 "$work/d1.db" < "$work/d1.sql"

# Each table as CSV. sqlite3 quotes empty text and leaves NULL unquoted, as Postgres reads them.
for table in "$@"; do
  info="FROM pragma_table_info('$table')"
  odd=$(sqlite3 "$work/d1.db" "SELECT count(*) $info WHERE name GLOB '[0-9]*' OR name GLOB '*[^A-Za-z0-9_]*'")
  [ "$odd" = 0 ] || fail "$table has a column whose name isn't letters, digits and underscores"
  columns=$(sqlite3 "$work/d1.db" "SELECT group_concat('\"' || name || '\"', ', ') $info")
  [ -n "$columns" ] || fail "D1 has no table named $table"
  sqlite3 -csv -header "$work/d1.db" "SELECT $columns FROM \"$table\"" > "$work/$table.csv"
  printf '%s\n' "\\copy \"$table\" ($columns) FROM '$work/$table.csv' WITH (FORMAT csv, HEADER true)" >> "$work/copy.sql"
done

# Every table in one transaction, so a failure copies nothing.
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 --quiet --file "$work/copy.sql"
