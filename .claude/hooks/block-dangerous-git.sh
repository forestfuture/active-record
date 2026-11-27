#!/bin/bash
# Blocks git commands an agent must not run here: staging everything at once (the human may have
# work in progress, so stage files by path), and commands that throw work away. A force-push goes
# through `node scripts/push-branch.mjs`, which pushes only the checked-out issue branch, with a
# lease (docs/agents/workflow.md, step 5). Each block says what to do instead.

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
STAGE="Stage files by path: git add <path>..., or git add -u <path>..."
DISCARD="Leave discarding work to the human: say what you'd discard, and ask them to."
PUSH="Push the checked-out issue branch with node scripts/push-branch.mjs; a branch other than <issue>-<slug> is the human's to push."
BRANCH="Remove a merged branch with node scripts/remove-merged-branch.mjs <branch>, from the main checkout; otherwise leave it to the human."
# Each pattern, then what to do instead.
BLOCKED=(
  "$GIT add( -[^ ]+)* (-A|--all|\.|:/)( |$)" "$STAGE"
  "$GIT add( -[^ ]+)* (-u|--update)( -[^ ]+)*( [0-9]?>[^ ]*)* *$" "$STAGE"
  "$GIT commit( -[^ ]+)* (-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)" "$STAGE"
  "$GIT reset( [^ ]+)* --hard" "$DISCARD"
  "$GIT clean( -[^ ]+)* -[a-zA-Z]*f" "$DISCARD"
  "$GIT (checkout|restore)( --)? \.( |$)" "$DISCARD"
  "$GIT branch( -[^ ]+)* -[a-zA-Z]*D" "$BRANCH"
  "$GIT branch( -[^ ]+)* -[a-zA-Z]*(d[a-zA-Z]*f|f[a-zA-Z]*d)" "$BRANCH"
  "$GIT branch( -[^ ]+)* $DELETE( -[^ ]+)* $FORCE( |$)" "$BRANCH"
  "$GIT branch( -[^ ]+)* $FORCE( -[^ ]+)* $DELETE( |$)" "$BRANCH"
  "$GIT push( [^ ]+)* (--force[^ ]*|-[a-zA-Z]*f[a-zA-Z]*|--mirror|--delete|-d|\+[^ ]+|:[^ ]+)( |$)" "$PUSH"
)

# Each simple command on its own line, so an allowed command can't carry a blocked one with it.
SEGMENTS=${COMMAND//&/$'\n'}
SEGMENTS=${SEGMENTS//|/$'\n'}
SEGMENTS=${SEGMENTS//;/$'\n'}

while IFS= read -r segment; do
  for ((i = 0; i < ${#BLOCKED[@]}; i += 2)); do
    if grep -qE "${BLOCKED[i]}" <<<"$segment"; then
      echo "BLOCKED: '$segment' matches '${BLOCKED[i]}'. ${BLOCKED[i + 1]}" >&2
      exit 2
    fi
  done
done <<<"$SEGMENTS"

exit 0
