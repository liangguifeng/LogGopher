// Package main composes the Wails desktop shell and application dependencies.
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/liangguifeng/LogGopher/internal/adapter"
	"github.com/liangguifeng/LogGopher/internal/application"
	"github.com/liangguifeng/LogGopher/internal/credential"
	"github.com/liangguifeng/LogGopher/internal/logging"
	"github.com/liangguifeng/LogGopher/internal/storage"
	wailslogger "github.com/wailsapp/wails/v2/pkg/logger"
)

const (
	preferredWindowWidth  = 1280
	preferredWindowHeight = 800
	minimumWindowWidth    = 1024
	minimumWindowHeight   = 680
)

// assets contains the production frontend bundled into the desktop binary.
//
//go:embed all:frontend/dist
var assets embed.FS

// main composes infrastructure and starts the native Wails event loop.
func main() {
	logManager, err := logging.New()
	if err != nil {
		log.Fatal(err)
	}
	defer logManager.Close()
	appLogger := logManager.Logger()
	appLogger.Info("application starting", "log_directory", logManager.Directory())

	store, err := storage.Open()
	if err != nil {
		appLogger.Error("open storage", "error", err)
		return
	}
	credentialStore := credential.NewSQLiteStore(store, credential.NewKeyringStore())
	app := NewApp(application.NewService(store, adapter.DefaultRegistry(), credentialStore), appLogger, logManager.Directory())
	settings, err := store.Settings()
	if err != nil {
		appLogger.Error("load settings", "error", err)
		_ = store.Close()
		return
	}
	appMenu := newApplicationMenu(app, settings.Language)

	// Create application with options
	err = wails.Run(&options.App{
		Title:     "LogGopher",
		Width:     preferredWindowWidth,
		Height:    preferredWindowHeight,
		MinWidth:  minimumWindowWidth,
		MinHeight: minimumWindowHeight,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Menu:               appMenu,
		Logger:             logManager.WailsLogger(),
		LogLevel:           wailslogger.INFO,
		LogLevelProduction: wailslogger.INFO,
		Mac: &mac.Options{
			TitleBar:    mac.TitleBarHiddenInset(),
			DisableZoom: false,
			Preferences: &mac.Preferences{FullscreenEnabled: mac.Enabled},
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		appLogger.Error("application stopped with error", "error", err)
		return
	}
	appLogger.Info("application stopped")
}
