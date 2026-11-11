#!/bin/bash
# Blocks git commands an agent must not run here: staging everything at once (the human may have
# work in progress, so stage files by path), and commands that throw work away. Pushing an issue
# branch stays allowed (docs/agents/workflow.md, step 5).

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

BLOCKED_PATTERNS=(
  'git add( -[^ ]+)* (-A|--all|-u|--update|\.)( |$)'
  'git commit( -[^ ]+)* (-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)'
  'git reset --hard'
  'git clean( -[^ ]+)* -[a-zA-Z]*f'
  'git branch( -[^ ]+)* -D'
  'git (checkout|restore)( --)? \.( |$)'
  'git push( [^ ]+)* (--force[^ ]*|-f)( |$)'
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if grep -qE "$pattern" <<<"$COMMAND"; then
    echo "BLOCKED: '$COMMAND' matches '$pattern'. Stage files by path, and leave discarding work to the human." >&2
    exit 2
  fi
done

exit 0
