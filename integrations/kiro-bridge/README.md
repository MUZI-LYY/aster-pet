# Aster Kiro Bridge

This optional local extension lets Aster select an existing Kiro session by its validated local session ID. It listens only on the local loopback interface with a per-process random token and invokes the fixed Kiro session-switch and view commands.

It does not read conversations, execute prompts or arbitrary commands, create sessions, change Kiro settings, or start an application or window. Kiro works normally when Aster is not running or has been removed.
