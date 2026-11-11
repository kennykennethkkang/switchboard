#!/usr/bin/env bash
# Moves this checkout from agent-flow to switchboard, with the Claude, Codex and
# Switchboard data keyed by its path or name. Dry run unless --apply. Safe to rerun.
# Run it from a plain terminal outside the folder, with VS Code, Claude and Codex closed.
set -euo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1
OLD=agent-flow
NEW=switchboard
GH_DIR="${GH_DIR:-$HOME/Documents/GitHub}"
SRC="$GH_DIR/$OLD"
DST="$GH_DIR/$NEW"
C="$HOME/.claude"
SB="$C/switchboard"
CODEX="${CODEX_HOME:-$HOME/.codex}"
LSOF="${LSOF:-lsof}"

say() { echo "$*"; }
act() {
  say "  + $*"
  if (( APPLY )); then "$@"; fi
}

# Claude keys project folders by path with / and . turned into -
key() { printf '%s' "$1" | tr '/.' '--'; }

# Moves $1 to $2; when both exist, moves children over without overwriting.
move() {
  local from=$1 to=$2
  [[ -e "$from" ]] || return 0
  if [[ ! -e "$to" ]]; then act mv "$from" "$to"; return 0; fi
  say "  both exist, merging $from into $to"
  local f
  for f in "$from"/* "$from"/.[!.]*; do
    [[ -e "$f" ]] || continue
    if [[ -e "$to/$(basename "$f")" ]]; then say "  kept, already in target: $f"
    else act mv "$f" "$to/"; fi
  done
  if (( APPLY )); then rmdir "$from" 2>/dev/null || say "  left behind: $from"; fi
}

# Rewrites old path and name in a text file, keeping a .pre-rename copy once.
rewrite() {
  local f=$1
  [[ -f "$f" ]] && grep -q -e "$SRC" -e "\"$OLD\"" -e "/$OLD/" "$f" 2>/dev/null || return 0
  [[ -e "$f.pre-rename" ]] || act cp "$f" "$f.pre-rename"
  if (( APPLY )); then
    SRC="$SRC" DST="$DST" OLD="$OLD" NEW="$NEW" perl -pi -e '
      s/\Q$ENV{SRC}\E(?=["\/\\\]]|$)/$ENV{DST}/g;
      s/"\Q$ENV{OLD}\E"/"$ENV{NEW}"/g;
      s/\/uploads\/\Q$ENV{OLD}\E\//\/uploads\/$ENV{NEW}\//g;
    ' "$f"
  fi
}

if (( ! APPLY )); then say "Dry run. Pass --apply to make these changes."; fi

busy=$("$LSOF" -nP -d cwd -Fcn 2>/dev/null | awk -v src="$SRC" '
  /^c/ { cmd = substr($0, 2) }
  /^n/ { p = substr($0, 2); if ((p == src || index(p, src "/") == 1) && (cmd ~ /Code|Electron|claude|codex/ || cmd ~ /^[0-9]+\.[0-9]+\.[0-9]+$/)) print cmd " in " p }
' || true)
if [[ -n "$busy" ]]; then
  say "These still run inside $SRC; --apply refuses until they are closed:"
  say "$busy"
  if (( APPLY )); then exit 1; fi
fi

if [[ -e "$SRC" && -e "$DST" ]]; then say "Refusing: both $SRC and $DST exist."; exit 1; fi

say "Checkout"
move "$SRC" "$DST"

say "Claude project folders (chats and memory)"
oldkey=$(key "$SRC")
newkey=$(key "$DST")
for d in "$C/projects/$oldkey" "$C/projects/$oldkey"-*; do
  [[ -d "$d" ]] || continue
  name=$(basename "$d")
  move "$d" "$C/projects/$newkey${name#"$oldkey"}"
done

say "Switchboard data"
move "$SB/uploads/$OLD" "$SB/uploads/$NEW"
move "$C/handoffs/$OLD" "$C/handoffs/$NEW"
move "$SB/rc-$OLD.log" "$SB/rc-$NEW.log"
for f in "$SB"/uploads/*/INDEX.md "$SB"/*.json "$SB"/todo/*.json "$SB"/chat-profiles/*; do rewrite "$f"; done
for f in "$C"/jev-presets/"$OLD"-*.json; do
  [[ -f "$f" ]] || continue
  move "$f" "$C/jev-presets/$NEW${f##*/"$OLD"}"
done

say "Codex trusted projects"
if [[ -f "$CODEX/config.toml" ]] && grep -q "\[projects.\"$SRC" "$CODEX/config.toml"; then
  [[ -e "$CODEX/config.toml.pre-rename" ]] || act cp "$CODEX/config.toml" "$CODEX/config.toml.pre-rename"
  if (( APPLY )); then
    SRC="$SRC" DST="$DST" perl -pi -e 's/^\[projects\."\Q$ENV{SRC}\E(?=["\/])/[projects."$ENV{DST}/' "$CODEX/config.toml"
  fi
fi

say "Git remote"
repo="$DST"; [[ -d "$repo" ]] || repo="$SRC"
url=$(git -C "$repo" remote get-url origin 2>/dev/null || true)
if [[ "$url" == *"/$OLD.git" || "$url" == *"/$OLD" || "$url" == *":$OLD.git" ]]; then
  if (( APPLY )); then repo="$DST"; fi
  act git -C "$repo" remote set-url origin "${url%"$OLD"*}$NEW.git"
fi

say ""
say "Then rename the GitHub repo yourself (not run here):"
say "  gh repo rename $NEW -R kennykennethkkang/$OLD"
