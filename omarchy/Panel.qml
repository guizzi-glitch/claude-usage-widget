import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "asm444.codex-usage"
  ipcTarget: "asm444.codex-usage"
  manageIpc: false

  readonly property var usageRecord: usage.record || ({})
  readonly property var limits: usageRecord.rateLimits || ({})
  readonly property var session: limits.session || ({})
  readonly property var weekly: limits.weeklyAll || limits.weekly || ({})
  readonly property var activity: usageRecord.activity || ({})
  readonly property real sessionPercent: clamp(Number(session.percentUsed || 0), 0, 100)
  readonly property real weeklyPercent: clamp(Number(weekly.percentUsed || 0), 0, 100)
  readonly property bool hasData: usageRecord.available === true
  readonly property bool alarming: sessionPercent >= 80 || weeklyPercent >= 80
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.55)
  readonly property color track: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.14)
  readonly property color accent: alarming ? urgent : Color.accent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  property double nowMs: Date.now()

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, isFinite(value) ? value : low))
  }

  function formatTokens(value) {
    var number = Number(value || 0)
    if (number >= 1000000000) return (number / 1000000000).toFixed(1) + "B"
    if (number >= 1000000) return (number / 1000000).toFixed(1) + "M"
    if (number >= 1000) return (number / 1000).toFixed(0) + "K"
    return String(Math.round(number))
  }

  function resetText(window) {
    var raw = String(window && window.resetsAt || "")
    if (raw === "") return "Reset time unavailable"
    var target = new Date(raw).getTime()
    if (!isFinite(target)) return "Reset time unavailable"
    var minutes = Math.max(0, Math.floor((target - nowMs) / 60000))
    var days = Math.floor(minutes / 1440)
    var hours = Math.floor((minutes % 1440) / 60)
    var rest = minutes % 60
    var countdown = days > 0 ? days + "d " + hours + "h" : (hours > 0 ? hours + "h " + rest + "m" : rest + "m")
    return "Resets in " + countdown + " · " + Qt.formatDateTime(new Date(target), "ddd HH:mm")
  }

  function refresh() {
    usage.refresh()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    nowMs = Date.now()
    usage.reload()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  UsageData {
    id: usage
    settings: root.settings
  }

  Timer {
    interval: 30000
    running: root.opened
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refresh(); return "ok" }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.hasData ? "󰚩 " + Math.round(root.sessionPercent) + "%" : "󰚩 --"
    active: root.alarming
    tooltipText: root.hasData
      ? "Codex · session " + Math.round(root.sessionPercent) + "% · weekly " + Math.round(root.weeklyPercent) + "%"
      : (usage.error || "Codex usage is loading")
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.MiddleButton) root.refresh()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: popup
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: popup.fittedContentWidth(Style.space(390))
    contentHeight: popup.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: content
          width: parent.width
          spacing: Style.space(14)

          Row {
            width: parent.width
            spacing: Style.space(12)

            Text {
              text: "󰚩"
              color: root.accent
              font.family: root.fontFamily
              font.pixelSize: 32
            }

            Column {
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)
              Text {
                text: "Codex usage"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }
              Text {
                text: root.hasData
                  ? String(root.limits.plan || "Subscription") + " · " + String(root.usageRecord.source || "local")
                  : (usage.error || "Loading usage data")
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            Item { width: 1; height: 1 }
          }

          Column {
            width: parent.width
            spacing: Style.space(7)

            Text {
              text: "SESSION"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }
            Row {
              width: parent.width
              Text {
                width: parent.width - sessionValue.width
                text: root.resetText(root.session)
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
              Text {
                id: sessionValue
                text: Math.round(root.sessionPercent) + "%"
                color: root.sessionPercent >= 80 ? root.urgent : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
              }
            }
            Rectangle {
              width: parent.width
              height: Style.space(6)
              radius: height / 2
              color: root.track
              Rectangle {
                width: parent.width * root.sessionPercent / 100
                height: parent.height
                radius: height / 2
                color: root.sessionPercent >= 80 ? root.urgent : Color.accent
                Behavior on width { NumberAnimation { duration: 250 } }
              }
            }
          }

          Column {
            width: parent.width
            spacing: Style.space(7)

            Text {
              text: "WEEKLY"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }
            Row {
              width: parent.width
              Text {
                width: parent.width - weeklyValue.width
                text: root.resetText(root.weekly)
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
              Text {
                id: weeklyValue
                text: Math.round(root.weeklyPercent) + "%"
                color: root.weeklyPercent >= 80 ? root.urgent : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
              }
            }
            Rectangle {
              width: parent.width
              height: Style.space(6)
              radius: height / 2
              color: root.track
              Rectangle {
                width: parent.width * root.weeklyPercent / 100
                height: parent.height
                radius: height / 2
                color: root.weeklyPercent >= 80 ? root.urgent : Color.accent
                Behavior on width { NumberAnimation { duration: 250 } }
              }
            }
          }

          Rectangle { width: parent.width; height: 1; color: root.track }

          Row {
            width: parent.width
            spacing: Style.space(18)

            Column {
              width: (parent.width - parent.spacing * 2) / 3
              Text { text: root.formatTokens(root.activity.last7DaysTokens); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
              Text { text: "7-day tokens"; color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            }
            Column {
              width: (parent.width - parent.spacing * 2) / 3
              Text { text: String(root.activity.last7DaysTurns || 0); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
              Text { text: "turns"; color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            }
            Column {
              width: (parent.width - parent.spacing * 2) / 3
              Text { text: String(root.activity.last7DaysSessions || 0); color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
              Text { text: "sessions"; color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            }
          }

          Text {
            width: parent.width
            text: usage.refreshing ? "Refreshing…" : "Middle-click the bar widget to refresh"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            horizontalAlignment: Text.AlignRight
          }
        }
      }
    }
  }
}
