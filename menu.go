package main

import (
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const projectURL = "https://github.com/liangguifeng/LogGopher"

func newApplicationMenu(app *App, language string) *menu.Menu {
	l := menuLabelsFor(language)
	bar := menu.NewMenu()

	application := bar.AddSubmenu("LogGopher")
	application.AddText(l.about, nil, func(*menu.CallbackData) {
		_, _ = runtime.MessageDialog(app.ctx, runtime.MessageDialogOptions{
			Type: runtime.InfoDialog, Title: "LogGopher", Message: "LogGopher\n多云日志工作台\n\nGo + Wails + React",
		})
	})
	application.AddText(l.settings, keys.CmdOrCtrl(","), emit(app, "menu:open-settings"))
	application.AddSeparator()
	application.AddText(l.hide, keys.CmdOrCtrl("h"), func(*menu.CallbackData) { runtime.Hide(app.ctx) })
	application.AddSeparator()
	application.AddText(l.quit, keys.CmdOrCtrl("q"), func(*menu.CallbackData) { runtime.Quit(app.ctx) })

	file := bar.AddSubmenu(l.file)
	file.AddText(l.newConnection, keys.CmdOrCtrl("n"), emit(app, "menu:new-connection"))
	file.AddText(l.reconnect, keys.CmdOrCtrl("r"), emit(app, "menu:reconnect"))

	bar.Append(menu.EditMenu())

	view := bar.AddSubmenu(l.view)
	appearance := view.AddSubmenu(l.appearance)
	appearance.AddText(l.system, nil, emitValue(app, "menu:set-theme", "system"))
	appearance.AddText(l.light, nil, emitValue(app, "menu:set-theme", "light"))
	appearance.AddText(l.dark, nil, emitValue(app, "menu:set-theme", "dark"))
	languageMenu := view.AddSubmenu(l.language)
	languageMenu.AddText("简体中文", nil, emitValue(app, "menu:set-language", "zh-CN"))
	languageMenu.AddText("English", nil, emitValue(app, "menu:set-language", "en-US"))
	density := view.AddSubmenu(l.density)
	density.AddText(l.comfortable, nil, emitValue(app, "menu:set-density", "comfortable"))
	density.AddText(l.compact, nil, emitValue(app, "menu:set-density", "compact"))
	view.AddSeparator()
	view.AddText(l.reload, keys.Combo("r", keys.CmdOrCtrlKey, keys.ShiftKey), func(*menu.CallbackData) { runtime.WindowReload(app.ctx) })
	view.AddText(l.fullscreen, fullscreenAccelerator(), func(*menu.CallbackData) { toggleFullscreen(app) })

	window := bar.AddSubmenu(l.window)
	window.AddText(l.minimise, keys.CmdOrCtrl("m"), func(*menu.CallbackData) { runtime.WindowMinimise(app.ctx) })
	window.AddText(l.maximise, nil, func(*menu.CallbackData) { runtime.WindowToggleMaximise(app.ctx) })
	window.AddText(l.center, nil, func(*menu.CallbackData) { runtime.WindowCenter(app.ctx) })
	window.AddText(l.showWindow, nil, func(*menu.CallbackData) { runtime.WindowShow(app.ctx) })
	window.AddSeparator()
	window.AddText(l.closeWindow, keys.CmdOrCtrl("w"), func(*menu.CallbackData) { runtime.WindowHide(app.ctx) })

	help := bar.AddSubmenu(l.help)
	help.AddText(l.shortcuts, keys.CmdOrCtrl("/"), func(*menu.CallbackData) {
		_, _ = runtime.MessageDialog(app.ctx, runtime.MessageDialogOptions{
			Type: runtime.InfoDialog, Title: l.shortcuts, Message: l.shortcutHelp,
		})
	})
	help.AddText(l.project, nil, func(*menu.CallbackData) { runtime.BrowserOpenURL(app.ctx, projectURL) })

	return bar
}

type menuLabels struct {
	about, settings, hide, quit, file, newConnection, reconnect string
	view, appearance, system, light, dark, language, density    string
	comfortable, compact, fullscreen, reload, window, minimise  string
	maximise, center, showWindow, closeWindow, help, shortcuts  string
	shortcutHelp, project                                       string
}

func menuLabelsFor(language string) menuLabels {
	if language == "en-US" {
		return menuLabels{about: "About LogGopher", settings: "Settings…", hide: "Hide LogGopher", quit: "Quit LogGopher",
			file: "File", newConnection: "New Connection", reconnect: "Reconnect", view: "View", appearance: "Appearance",
			system: "System", light: "Light", dark: "Dark", language: "Language", density: "Display Density",
			comfortable: "Comfortable", compact: "Compact", fullscreen: "Toggle Full Screen", reload: "Reload Interface",
			window: "Window", minimise: "Minimize", maximise: "Maximize / Restore", center: "Center Window", showWindow: "Show Main Window", closeWindow: "Close Window", help: "Help",
			shortcuts: "Keyboard Shortcuts", shortcutHelp: "Cmd/Ctrl + N  New connection\nCmd/Ctrl + R  Reconnect\nCmd/Ctrl + ,  Settings\nCmd/Ctrl + Enter  Run query\nCtrl + Cmd/Ctrl + F  Toggle full screen\nEsc  Close panel", project: "Project Homepage"}
	}
	return menuLabels{about: "关于 LogGopher", settings: "设置…", hide: "隐藏 LogGopher", quit: "退出 LogGopher",
		file: "文件", newConnection: "新建连接", reconnect: "重新连接", view: "视图", appearance: "外观",
		system: "跟随系统", light: "亮色", dark: "暗色", language: "语言", density: "显示密度",
		comfortable: "舒适", compact: "紧凑", fullscreen: "切换全屏", reload: "重新加载界面",
		window: "窗口", minimise: "最小化", maximise: "最大化 / 还原", center: "窗口居中", showWindow: "显示主窗口", closeWindow: "关闭窗口", help: "帮助",
		shortcuts: "键盘快捷键", shortcutHelp: "⌘/Ctrl + N  新建连接\n⌘/Ctrl + R  重新连接\n⌘/Ctrl + ,  设置\n⌘/Ctrl + Enter  运行查询\nCtrl + ⌘/Ctrl + F  切换全屏\nEsc  关闭面板", project: "项目主页"}
}

func toggleFullscreen(app *App) {
	if runtime.WindowIsFullscreen(app.ctx) {
		runtime.WindowUnfullscreen(app.ctx)
		return
	}
	runtime.WindowFullscreen(app.ctx)
}

func fullscreenAccelerator() *keys.Accelerator {
	if goruntime.GOOS == "darwin" {
		return keys.Combo("f", keys.CmdOrCtrlKey, keys.ControlKey)
	}
	return keys.Key("f11")
}

func emit(app *App, event string) menu.Callback {
	return func(*menu.CallbackData) { runtime.EventsEmit(app.ctx, event) }
}

func emitValue(app *App, event, value string) menu.Callback {
	return func(*menu.CallbackData) { runtime.EventsEmit(app.ctx, event, value) }
}
