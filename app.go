package main

import (
	"context"
	"errors"

	"github.com/liangguifeng/LogGopher/internal/application"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	service *application.Service
	ctx     context.Context
}

// NewApp creates a new App application struct
func NewApp(service *application.Service) *App {
	return &App{service: service}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.service.Start(ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.service.Close()
}

func (a *App) Bootstrap() (domain.Bootstrap, error) {
	return a.service.Bootstrap()
}

func (a *App) Connect(input domain.ConnectionInput) (domain.Session, error) {
	if err := input.Validate(); err != nil {
		return domain.Session{}, err
	}
	return a.service.Connect(input)
}

func (a *App) ConnectSaved(profileID int64) (domain.Session, error) {
	if profileID <= 0 {
		return domain.Session{}, errors.New("profile is required")
	}
	return a.service.ConnectSaved(profileID)
}

func (a *App) Query(input domain.QueryInput) (domain.QueryResult, error) {
	if input.Logstore == "" {
		return domain.QueryResult{}, errors.New("logstore is required")
	}
	return a.service.Query(input)
}

func (a *App) SaveSettings(settings domain.Settings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	if err := a.service.SaveSettings(settings); err != nil {
		return err
	}
	runtime.MenuSetApplicationMenu(a.ctx, newApplicationMenu(a, settings.Language))
	return nil
}
