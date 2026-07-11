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
	"github.com/liangguifeng/LogGopher/internal/storage"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	store, err := storage.Open()
	if err != nil {
		log.Fatal(err)
	}
	app := NewApp(application.NewService(store, adapter.DefaultRegistry(), credential.NewKeyringStore()))
	settings, err := store.Settings()
	if err != nil {
		log.Fatal(err)
	}
	appMenu := newApplicationMenu(app, settings.Language)

	// Create application with options
	err = wails.Run(&options.App{
		Title:     "LogGopher",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 680,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Menu: appMenu,
		Mac: &mac.Options{
			TitleBar:    mac.TitleBarDefault(),
			DisableZoom: false,
			Preferences: &mac.Preferences{FullscreenEnabled: mac.Enabled},
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
