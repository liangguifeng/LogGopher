package main

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/liangguifeng/LogGopher/internal/application"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/logging"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails boundary exposed to the generated frontend bindings.
type App struct {
	service      *application.Service
	ctx          context.Context
	logger       *slog.Logger
	logDirectory string
}

// NewApp creates the Wails boundary with its service and logging dependencies.
func NewApp(service *application.Service, logger *slog.Logger, logDirectory string) *App {
	return &App{service: service, logger: logger, logDirectory: logDirectory}
}

// startup stores the Wails runtime context and starts the application service.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.logger.Info("application ready")
	a.service.Start(ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.logger.Info("application shutting down")
	if err := a.service.Close(); err != nil {
		a.logger.Error("close application service", "error", err)
	}
}

// Bootstrap returns initial application data to the frontend.
func (a *App) Bootstrap() (domain.Bootstrap, error) {
	return a.service.Bootstrap()
}

// Connect validates and saves a new connection before opening its session.
func (a *App) Connect(input domain.ConnectionInput) (domain.Session, error) {
	started := time.Now()
	if err := input.Validate(); err != nil {
		a.logger.Warn("connection validation failed", "adapter_id", input.AdapterID, "error", err)
		return domain.Session{}, err
	}
	session, err := a.service.Connect(input)
	if err != nil {
		a.logger.Error("connection failed", "adapter_id", input.AdapterID, "duration_ms", time.Since(started).Milliseconds(), "error", err)
		return domain.Session{}, err
	}
	a.logger.Info("connection established", "adapter_id", input.AdapterID, "profile_id", session.ProfileID, "logstore_count", sessionLogstoreCount(session), "duration_ms", time.Since(started).Milliseconds())
	return session, nil
}

// ConnectSaved restores and opens a previously saved connection.
func (a *App) ConnectSaved(profileID int64) (domain.Session, error) {
	started := time.Now()
	if profileID <= 0 {
		return domain.Session{}, errors.New("profile is required")
	}
	session, err := a.service.ConnectSaved(profileID)
	if err != nil {
		a.logger.Error("saved connection failed", "profile_id", profileID, "duration_ms", time.Since(started).Milliseconds(), "error", err)
		return domain.Session{}, err
	}
	a.logger.Info("saved connection established", "profile_id", profileID, "logstore_count", sessionLogstoreCount(session), "duration_ms", time.Since(started).Milliseconds())
	return session, nil
}

// Query executes a normalized log query and records operational metrics.
func (a *App) Query(input domain.QueryInput) (domain.QueryResult, error) {
	started := time.Now()
	if input.Logstore == "" {
		return domain.QueryResult{}, errors.New("logstore is required")
	}
	result, err := a.service.Query(input)
	if err != nil {
		a.logger.Error("query failed", "profile_id", input.ProfileID, "logstore", input.Logstore, "page", input.Page, "limit", input.Limit, "duration_ms", time.Since(started).Milliseconds(), "error", err)
		return domain.QueryResult{}, err
	}
	a.logger.Info("query completed", "profile_id", input.ProfileID, "logstore", input.Logstore, "page", input.Page, "limit", input.Limit, "result_count", len(result.Entries), "total", result.Total, "duration_ms", time.Since(started).Milliseconds())
	return result, nil
}

// QueryHistory returns persisted query history for the active logstore.
func (a *App) QueryHistory(profileID int64, group, logstore string) ([]domain.QueryHistoryItem, error) {
	if profileID <= 0 || logstore == "" {
		return []domain.QueryHistoryItem{}, nil
	}
	return a.service.QueryHistory(profileID, group, logstore)
}

func sessionLogstoreCount(session domain.Session) int {
	total := 0
	for _, group := range session.Groups {
		total += len(group.Logstores)
	}
	return total
}

// SaveSettings persists preferences and rebuilds the localized native menu.
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

func (a *App) openLogDirectory() error {
	a.logger.Info("opening log directory")
	return logging.OpenDirectory(a.logDirectory)
}
