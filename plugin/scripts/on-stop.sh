#!/usr/bin/env bash
# protocontent Stop hook.
#
# Narrow safety net: if the agent published to protocontent DURING THIS TURN but
# its final message shares no protocontent link, nudge ONCE to paste the link.
# Otherwise stay completely out of the way.
#
# Four earlier failure modes this version fixes:
#   1. It matched the substring "publish" anywhere in the transcript tail, so
#      merely editing code that contains the word "publish" tripped it. We now
#      match the structured tool_use NAME (mcp__protocontent__publish_html/folder).
#   2. It scanned a fixed 400-line window, so a publish from a PREVIOUS turn kept
#      re-triggering the nag. We now scope strictly to the CURRENT turn (messages
#      after the last genuine user prompt) and fail open if the boundary is
#      unclear.
#   3. A publish ATTEMPT that the permission system denied still counted as
#      "published". We now require a successful tool_result (same tool_use id,
#      is_error != true) before treating the turn as having published.
#   4. It only read the LAST assistant transcript event, but one assistant
#      message can be written as several events (and links are often shared
#      mid-turn), so it nagged even when the link was already on screen. We now
#      accept a protocontent link anywhere in the turn's assistant text.
#
# Block protocol: print {"decision":"block","reason":...} to stdout, exit 0.
# Allow: exit 0 with no output. Never exit non-zero (stay quiet on any error).
# Disable entirely with PROTOCONTENT_DISABLE_STOP_HOOK=1.

input="$(cat)"
allow() { exit 0; }

[ "${PROTOCONTENT_DISABLE_STOP_HOOK:-}" = "1" ] && allow
command -v jq >/dev/null 2>&1 || allow

# Don't loop: if we already blocked once this turn, let the stop through.
active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
[ "$active" = "true" ] && allow

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
{ [ -n "$transcript" ] && [ -f "$transcript" ]; } || allow

# Decide on the CURRENT turn only. A turn = the transcript entries after the last
# genuine user prompt (a `user` line that is neither a tool_result nor a
# system/meta reminder). If we can't locate that boundary in the tail, fail open.
verdict="$(tail -n 800 "$transcript" 2>/dev/null | jq -rs '
  def genuine:
    .type == "user"
    and (.isMeta != true)
    and ((.message.content // null) as $c
         | if   ($c | type) == "string" then ($c | length) > 0
           elif ($c | type) == "array"  then (any($c[]?; .type == "tool_result") | not)
           else false end);
  def blocks: (.message.content // []) | if type == "array" then .[] else empty end;
  to_entries as $e
  | ($e | map(select(.value | genuine)) | last | .key) as $u
  | if $u == null then "ok"
    else
      [ $e[range($u + 1; ($e | length))].value ] as $turn
      # A publish only counts if the tool_use has a SUCCESSFUL tool_result in
      # this turn — a permission-denied or errored attempt published nothing.
      | ([ $turn[] | select(.type == "assistant") | blocks
           | select(.type == "tool_use"
                    and ((.name // "") | test("mcp__protocontent__publish_(html|folder)")))
           | .id ]) as $attempts
      | ([ $turn[] | select(.type == "user") | blocks
           | select(.type == "tool_result" and (.is_error != true))
           | .tool_use_id ]) as $succeeded
      | ($attempts | any(. as $id | $succeeded | index($id) != null)) as $pub
      # Accept a link anywhere in the turn. Assistant messages can span several
      # transcript events, and a link shared mid-turn already counts.
      | ([ $turn[] | select(.type == "assistant") | blocks
           | select(.type == "text") | .text ] | join("\n")) as $txt
      | if ($pub and (($txt | test("protocontent\\.(app|com)")) | not)) then "nudge" else "ok" end
    end
' 2>/dev/null)" || allow

[ "$verdict" = "nudge" ] || allow

jq -n '{decision:"block", reason:"You published to protocontent this turn but did not share its link. Paste the markdown link from the publish result into your reply — one short line, nothing else."}'
