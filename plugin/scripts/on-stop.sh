#!/usr/bin/env bash
# protocontent Stop hook.
#
# If the agent published to protocontent during this turn but its final message
# contains no protocontent link, nudge ONCE to surface the links. Otherwise stay
# out of the way. Fail-open and conservative: any uncertainty allows the stop.
# Disable entirely with PROTOCONTENT_DISABLE_STOP_HOOK=1.
#
# Block protocol: print {"decision":"block","reason":...} to stdout and exit 0.
# Allow: exit 0 with no output. We never exit non-zero (stay quiet on errors).

input="$(cat)"
allow() { exit 0; }

[ "${PROTOCONTENT_DISABLE_STOP_HOOK:-}" = "1" ] && allow
command -v jq >/dev/null 2>&1 || allow

# Don't loop: if we already blocked once this turn, let the stop through.
active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
[ "$active" = "true" ] && allow

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
{ [ -n "$transcript" ] && [ -f "$transcript" ]; } || allow

tailbuf="$(tail -n 400 "$transcript" 2>/dev/null)" || allow

# Only act if a protocontent publish tool was actually used recently.
printf '%s' "$tailbuf" | grep -qE 'mcp__protocontent__publish_(html|folder)' || allow

# If the latest assistant message already shares a protocontent link, all good.
last_text="$(printf '%s' "$tailbuf" | jq -rs 'map(select(.type=="assistant")) | last // {} | (.message.content // []) | if type=="array" then (map(select(.type=="text").text) | join("\n")) else "" end' 2>/dev/null)"
printf '%s' "$last_text" | grep -qiE 'protocontent\.(app|com)' && allow

# Published but no link shared -> nudge once.
jq -n '{decision:"block", reason:"You published to protocontent this turn, but your final message has no protocontent link. Run the `list` tool, then share BOTH the private session-index link (the ?k= URL that shows everything) and each worked-on artifact'"'"'s direct link before finishing."}'
