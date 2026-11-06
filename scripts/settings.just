# Settings every justfile shares. A module reads no setting from the justfile that loads it, so
# each one imports this file.

set shell := ["bash", "-euo", "pipefail", "-c"]
set script-interpreter := ["bash", "-euo", "pipefail"]
set positional-arguments
