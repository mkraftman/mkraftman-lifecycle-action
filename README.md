# Mkraftman Lifecycle Action

Invisible Lovelace card that drives device launch/teardown from a **view's
lifecycle**, so dashboard tiles only need a native `navigate` action — no
browser_mod, no browser registration.

- View becomes active (arrival, or launch args in the URL change) → calls `launch`.
- Navigating away from the view → calls `teardown`.

Dedupe is module-level and survives HA destroying/recreating the card during a
page load, so cold-load remount churn collapses to one launch. Teardown is
navigation-guarded (fires only when the URL is no longer this view).

## Options

| Option | Default | Description |
| --- | --- | --- |
| `launch` | – | Service called on activate, e.g. `script.launch_apple_tv_app`. Omit for log-only mode. |
| `teardown` | – | Service called on leave, e.g. `script.pause_and_close_apple_tv`. |
| `teardown_data` | `{}` | Static data for the teardown call. |
| `defaults` | `{}` | Static data merged *under* harvested URL args for launch. |
| `param_prefix` | `arg_` | Which query keys become launch args (prefix stripped; `""` = all). |
| `overlay` | – | `input_boolean` turned on at activate (your script turns it off). |
| `view_path` | – | This view's path; used to decide if the card is on the active view. |
| `debug` | `false` | Verbose console logging. |

## Example

```yaml
# tile
tap_action:
  action: navigate
  navigation_path: /living-room/apple-tv?arg_source=Netflix&arg_app_name=Netflix
# device view
- type: custom:mkraftman-lifecycle-action
  view_path: apple-tv
  overlay: input_boolean.loading_overlay
  launch: script.launch_apple_tv_app
  teardown: script.pause_and_close_apple_tv
```
