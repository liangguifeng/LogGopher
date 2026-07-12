package logging

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	wailslogger "github.com/wailsapp/wails/v2/pkg/logger"
	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	applicationName = "LogGopher"
	logFileName     = "loggopher.log"
)

// Config controls the JSON log file location and retention policy.
type Config struct {
	Directory  string
	MaxSizeMB  int
	MaxBackups int
	MaxAgeDays int
	Level      slog.Leveler
}

// Manager owns the structured logger and its rotating file sink.
type Manager struct {
	directory string
	logger    *slog.Logger
	sink      *lumberjack.Logger
}

// New creates the application logger under the platform's user log directory.
func New() (*Manager, error) {
	directory, err := DefaultDirectory()
	if err != nil {
		return nil, err
	}
	return NewWithConfig(Config{Directory: directory})
}

// DefaultDirectory resolves a per-user, cross-platform location for application logs.
func DefaultDirectory() (string, error) {
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve user home directory: %w", err)
		}
		return filepath.Join(home, "Library", "Logs", applicationName), nil
	}
	if runtime.GOOS == "linux" {
		stateDir := os.Getenv("XDG_STATE_HOME")
		if stateDir == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", fmt.Errorf("resolve user home directory: %w", err)
			}
			stateDir = filepath.Join(home, ".local", "state")
		}
		return filepath.Join(stateDir, applicationName, "logs"), nil
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolve user cache directory: %w", err)
	}
	return filepath.Join(cacheDir, applicationName, "logs"), nil
}

// OpenDirectory reveals the log directory in the platform file manager.
func OpenDirectory(directory string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", directory)
	case "windows":
		command = exec.Command("explorer.exe", directory)
	default:
		command = exec.Command("xdg-open", directory)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("open log directory: %w", err)
	}
	if err := command.Process.Release(); err != nil {
		return fmt.Errorf("release log directory opener: %w", err)
	}
	return nil
}

// NewWithConfig creates a logger with explicit settings. It is primarily useful for tests.
func NewWithConfig(config Config) (*Manager, error) {
	config = withDefaults(config)
	if err := os.MkdirAll(config.Directory, 0o700); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	logPath := filepath.Join(config.Directory, logFileName)
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close initial log file: %w", err)
	}
	if err := os.Chmod(logPath, 0o600); err != nil {
		return nil, fmt.Errorf("secure log file permissions: %w", err)
	}

	sink := &lumberjack.Logger{
		Filename:   logPath,
		MaxSize:    config.MaxSizeMB,
		MaxBackups: config.MaxBackups,
		MaxAge:     config.MaxAgeDays,
		LocalTime:  true,
		Compress:   false,
	}
	handler := slog.NewJSONHandler(sink, &slog.HandlerOptions{Level: config.Level})
	logger := slog.New(handler).With("app", applicationName)

	return &Manager{directory: config.Directory, logger: logger, sink: sink}, nil
}

func withDefaults(config Config) Config {
	if config.MaxSizeMB <= 0 {
		config.MaxSizeMB = 10
	}
	if config.MaxBackups <= 0 {
		config.MaxBackups = 5
	}
	if config.MaxAgeDays <= 0 {
		config.MaxAgeDays = 14
	}
	if config.Level == nil {
		config.Level = slog.LevelInfo
	}
	return config
}

// Logger returns the application slog logger.
func (m *Manager) Logger() *slog.Logger { return m.logger }

// Directory returns the directory containing current and rotated .log files.
func (m *Manager) Directory() string { return m.directory }

// WailsLogger adapts slog to the Wails logger interface.
func (m *Manager) WailsLogger() wailslogger.Logger { return &wailsAdapter{logger: m.logger} }

// Close flushes and closes the rotating file sink.
func (m *Manager) Close() error { return m.sink.Close() }

type wailsAdapter struct{ logger *slog.Logger }

func (w *wailsAdapter) Print(message string) { w.logger.Info(message, "source", "wails") }
func (w *wailsAdapter) Trace(message string) {
	w.logger.Log(context.Background(), slog.LevelDebug-4, message, "source", "wails")
}
func (w *wailsAdapter) Debug(message string)   { w.logger.Debug(message, "source", "wails") }
func (w *wailsAdapter) Info(message string)    { w.logger.Info(message, "source", "wails") }
func (w *wailsAdapter) Warning(message string) { w.logger.Warn(message, "source", "wails") }
func (w *wailsAdapter) Error(message string)   { w.logger.Error(message, "source", "wails") }
func (w *wailsAdapter) Fatal(message string) {
	w.logger.Error(message, "source", "wails", "fatal", true)
	os.Exit(1)
}
