#!/usr/bin/env bash
# Creates a GitHub Projects (v2) kanban for Jev Fill and adds the ticket issues.
# Requires: gh auth with `project` scope (gh auth refresh -s project,read:project)
set -euo pipefail

OWNER="${OWNER:-kelvinvalani}"
REPO="${REPO:-kelvinvalani/jev-pilot}"
TITLE="${TITLE:-Jev Fill}"

# Ticket issue numbers → board status (Projects default Status options)
# Customize if your Status field uses different names.
declare -A ISSUE_STATUS=(
  [5]="Done"            # 01 confident text fill
  [6]="Ready"           # 02 one form
  [7]="Todo"            # 03 check/skip/stop/mint (needs restore)
  [8]="Todo"            # 04 situational answers
  [9]="Todo"            # 05 options on the machine
  [10]="Todo"           # 06 undo
  [11]="Todo"           # 07 repair the profile
  [12]="Ready"          # 08 failed call
)

echo "Checking project scope…"
if ! gh auth status -a 2>&1 | grep -Eqi 'project'; then
  echo "This token needs the project scope. Run:"
  echo "  gh auth refresh -s project,read:project"
  exit 1
fi

echo "Creating project “$TITLE” for @$OWNER…"
PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$TITLE" --format json)
PROJECT_NUMBER=$(echo "$PROJECT_JSON" | jq -r .number)
PROJECT_ID=$(echo "$PROJECT_JSON" | jq -r .id)
PROJECT_URL=$(echo "$PROJECT_JSON" | jq -r .url)
echo "Project #$PROJECT_NUMBER → $PROJECT_URL"

echo "Linking to $REPO…"
gh project link "$PROJECT_NUMBER" --owner "$OWNER" --repo "$REPO" 2>/dev/null || true

echo "Reading Status field…"
FIELDS=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json)
STATUS_FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name=="Status") | .id')
# Map option names → ids
option_id() {
  local name="$1"
  echo "$FIELDS" | jq -r --arg n "$name" '
    .fields[] | select(.name=="Status") | .options[]? | select(.name==$n) | .id
  '
}

echo "Adding issues and setting Status…"
for issue in 5 6 7 8 9 10 11 12; do
  status="${ISSUE_STATUS[$issue]}"
  item_json=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "https://github.com/$REPO/issues/$issue" --format json)
  item_id=$(echo "$item_json" | jq -r .id)
  opt=$(option_id "$status")
  if [[ -n "$opt" && "$opt" != "null" ]]; then
    gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$opt" >/dev/null
    echo "  #$issue → $status"
  else
    echo "  #$issue added (Status option “$status” not found — set it in the UI)"
  fi
done

# Close the accidental test issue if still open
gh issue close 4 -R "$REPO" --reason "not planned" 2>/dev/null || true
# Mark ticket 01 done on the board; leave the issue open until the PR merges if you prefer
gh issue close 5 -R "$REPO" --reason "completed" 2>/dev/null || true

echo
echo "Kanban ready: $PROJECT_URL"
echo "In the project UI: View → Board, group by Status (Todo / In Progress / Done / …)."
echo "Optional: add a custom Status option “Needs restore” for issues #7–#11."
