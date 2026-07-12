package logging

import (
	"bufio"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestJSONLoggerWritesStructuredOutput(t *testing.T) {
	directory := t.TempDir()
	manager, err := NewWithConfig(Config{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}

	manager.Logger().Info("connection established", "adapter_id", "tencent-cls", "profile_id", 7)
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}

	file, err := os.Open(filepath.Join(directory, logFileName))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		t.Fatalf("expected a JSON log line: %v", scanner.Err())
	}
	var entry map[string]any
	if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
		t.Fatalf("decode JSON log: %v", err)
	}
	if entry["level"] != "INFO" || entry["adapter_id"] != "tencent-cls" || entry["app"] != applicationName {
		t.Fatalf("unexpected structured entry: %#v", entry)
	}
	if entry["profile_id"] != float64(7) {
		t.Fatalf("structured attribute missing: %#v", entry)
	}
}

func TestNewWithConfigUsesSecureLogFilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not enforced on Windows")
	}
	directory := t.TempDir()
	manager, err := NewWithConfig(Config{Directory: directory, Level: slog.LevelDebug})
	if err != nil {
		t.Fatal(err)
	}
	manager.Logger().Debug("permission test")
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(directory, logFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("log file permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestDefaultDirectoryUsesPlatformLogLocation(t *testing.T) {
	directory, err := DefaultDirectory()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(directory) {
		t.Fatalf("log directory must be absolute: %s", directory)
	}
	if runtime.GOOS == "darwin" && !strings.HasSuffix(directory, filepath.Join("Library", "Logs", applicationName)) {
		t.Fatalf("unexpected macOS log directory: %s", directory)
	}
	if runtime.GOOS == "linux" && !strings.HasSuffix(directory, filepath.Join(applicationName, "logs")) {
		t.Fatalf("unexpected Linux log directory: %s", directory)
	}
}
