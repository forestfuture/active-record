#!/bin/bash
# Blocks git commands an agent must not run here: staging everything at once (the human may have
# work in progress, so stage files by path), and commands that throw work away. Pushing an issue
# branch stays allowed, and so does force-pushing it with a lease after a rebase,
# `git push --force-with-lease origin <issue>-<slug>:<issue>-<slug>` (docs/agents/workflow.md, step 5).

INPUT=$(jq -r '.tool_input.command // empty')

# The command without its heredoc bodies: a commit message may name a blocked command.
COMMAND=""
delimiter=""
heredoc='<<-?[[:space:]]*["'\'']?([A-Za-z_]+)'
while IFS= read -r line; do
  if [[ -n $delimiter ]]; then
    [[ $line == "$delimiter" ]] && delimiter=""
    continue
  fi
  COMMAND+="$line"$'\n'
  if [[ $line =~ $heredoc ]]; then delimiter=${BASH_REMATCH[1]}; fi
done <<<"$INPUT"

# One form for matching: tabs as spaces, runs of spaces as one, a quoted flag or refspec unquoted,
# and a redirect's `>&` as `>`, so `2>&1` isn't split as a background `&`.
# A backslash-newline continues the command, as bash reads it.
COMMAND=${COMMAND//\\$'\n'/ }
COMMAND=$(sed -E "s/[[:space:]]+/ /g; s/'([-+][^' ]*)'/\1/g; s/\"([-+][^\" ]*)\"/\1/g; s/>&/>/g" <<<"$COMMAND")

GIT='git( -[cC] [^ ]+)*'
FORCE='(--force|-[a-zA-Z]*f[a-zA-Z]*)'
DELETE='(--delete|-[a-zA-Z]*d[a-zA-Z]*)'
BLOCKED_PATTERNS=(
  "$GIT add( -[^ ]+)* (-A|--all|-u|--update|\.)( |$)"
  "$GIT commit( -[^ ]+)* (-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)"
  "$GIT reset( [^ ]+)* --hard"
  "$GIT clean( -[^ ]+)* -[a-zA-Z]*f"
  "$GIT branch( -[^ ]+)* -[a-zA-Z]*D"
  "$GIT branch( -[^ ]+)* -[a-zA-Z]*(d[a-zA-Z]*f|f[a-zA-Z]*d)"
  "$GIT branch( -[^ ]+)* $DELETE( -[^ ]+)* $FORCE( |$)"
  "$GIT branch( -[^ ]+)* $FORCE( -[^ ]+)* $DELETE( |$)"
  "$GIT (checkout|restore)( --)? \.( |$)"
  "$GIT push( [^ ]+)* (--force[^ ]*|-[a-zA-Z]*f[a-zA-Z]*|--mirror|--delete|-d|\+[^ ]+|:[^ ]+)( |$)"
)

# A forced push of an issue branch to itself, with a lease: `<issue>-<slug>:<issue>-<slug>`, flags
# limited to the lease and -u, output redirects allowed after it. A value is one plain word.
WORD='[^[:space:]&;|$()`<>\\]'
ISSUE='[0-9]+-[a-z0-9-]+'
ISSUE_BRANCH_PUSH="^ *git( -C $WORD+)? push(( --force-with-lease(=$WORD+)?)|( -u))+ origin ($ISSUE):($ISSUE)( [0-9]?>$WORD*)* *$"

# Each simple command on its own line, so one allowed push can't carry a blocked command with it.
SEGMENTS=${COMMAND//&/$'\n'}
SEGMENTS=${SEGMENTS//|/$'\n'}
SEGMENTS=${SEGMENTS//;/$'\n'}

while IFS= read -r segment; do
  if [[ $segment =~ $ISSUE_BRANCH_PUSH ]]; then
    source=${BASH_REMATCH[6]}
    target=${BASH_REMATCH[7]}
    [[ $source == "$target" ]] && continue
  fi
  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    if grep -qE "$pattern" <<<"$segment"; then
      echo "BLOCKED: '$COMMAND' matches '$pattern'. Stage files by path, and leave discarding work to the human." >&2
      exit 2
    fi
  done
done <<<"$SEGMENTS"

exit 0
