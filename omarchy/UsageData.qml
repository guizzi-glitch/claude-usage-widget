import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root
  visible: false

  property var settings: ({})
  property var record: ({})
  property string error: ""
  property bool refreshing: refreshProcess.running

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string dataPath: (Quickshell.env("XDG_DATA_HOME") || home + "/.local/share")
    + "/codex-usage-widget/usage-widget.json"
  readonly property string collectorPath: home + "/.local/bin/codex-usage-collector.py"
  readonly property int refreshIntervalSec: Math.max(30, Number(setting("refreshIntervalSec", 60)) || 60)

  function setting(key, fallback) {
    var value = settings ? settings[key] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function parse(raw) {
    var text = String(raw || "").trim()
    if (text === "") return
    try {
      record = JSON.parse(text)
      error = ""
    } catch (exception) {
      error = "Invalid usage data"
      console.warn("codex-usage: invalid JSON", exception)
    }
  }

  function reload() {
    usageFile.reload()
  }

  function refresh() {
    if (!refreshProcess.running) refreshProcess.running = true
  }

  FileView {
    id: usageFile
    path: root.dataPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.parse(text())
    onLoadFailed: if (Object.keys(root.record).length === 0) root.error = "Waiting for Codex usage data"
  }

  Process {
    id: refreshProcess
    command: [root.collectorPath]

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.parse(text)
    }

    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (String(text || "").trim() !== "")
        console.warn("codex-usage collector:", String(text).trim())
    }

    onExited: function(exitCode) {
      if (exitCode !== 0) root.error = "Usage refresh failed"
      else usageFile.reload()
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.reload()
  }
}
