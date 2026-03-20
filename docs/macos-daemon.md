# MacOS Daemon

To run this as a daemon process, you can use a launch agent to automatically run in the background. Update the config to the correct `WorkingDirectory` and whatever other changes you may want to make:

`~/Library/LaunchAgents/com.utah.worker.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.utah.worker</string>
    <key>WorkingDirectory</key>
    <string>/Users/path-to-cloned-repo</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>--env-file=.env</string>
        <string>--experimental-strip-types</string>
        <string>--experimental-transform-types</string>
        <string>--no-warnings</string>
        <string>src/worker.ts</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>INNGEST_DEV</key>
        <string>0</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/utah-worker.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/utah-worker.err</string>
</dict>
</plist>
```

Start your agent:

```
launchctl load ~/Library/LaunchAgents/com.utah.worker.plist
```

Stop your agent:

```
launchctl unload ~/Library/LaunchAgents/com.utah.worker.plist
```
