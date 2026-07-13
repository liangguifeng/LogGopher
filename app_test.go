package main

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/liangguifeng/LogGopher/internal/adapter"
	"github.com/liangguifeng/LogGopher/internal/application"
	"github.com/liangguifeng/LogGopher/internal/credential"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/storage"
)

type boundaryAdapter struct{}

func (boundaryAdapter) Info() domain.AdapterInfo {
	return domain.AdapterInfo{ID: "boundary", Name: "Boundary", Ready: true}
}
func (boundaryAdapter) Connect(context.Context, domain.ConnectionInput) ([]domain.LogGroup, error) {
	return []domain.LogGroup{{Name: "project", Logstores: []string{"app", "audit"}}}, nil
}
func (boundaryAdapter) Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error) {
	return domain.QueryResult{Total: 1, Entries: []domain.LogEntry{{Message: "ok"}}}, nil
}

type boundaryCredentials struct{ items map[int64]credential.Secret }

func (store *boundaryCredentials) Save(id int64, secret credential.Secret) error {
	store.items[id] = secret
	return nil
}
func (store *boundaryCredentials) Get(id int64) (credential.Secret, error) {
	return store.items[id], nil
}
func (store *boundaryCredentials) Delete(id int64) error { delete(store.items, id); return nil }

func newBoundaryApp(t *testing.T) *App {
	t.Helper()
	database, err := storage.OpenPath(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	registry := adapter.DefaultRegistry()
	registry.Register(boundaryAdapter{})
	service := application.NewService(database, registry, &boundaryCredentials{items: make(map[int64]credential.Secret)})
	app := NewApp(service, slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir())
	app.startup(context.Background())
	t.Cleanup(func() { app.shutdown(context.Background()) })
	return app
}

func TestAppConnectionQueryAndHistoryBoundary(t *testing.T) {
	app := newBoundaryApp(t)
	input := domain.ConnectionInput{
		AdapterID: "boundary", Name: "production", Endpoint: "https://example.com",
		AccessKey: "access", SecretKey: "secret",
	}
	session, err := app.Connect(input)
	if err != nil || session.ProfileID <= 0 || sessionLogstoreCount(session) != 2 {
		t.Fatalf("Connect() = %#v, %v", session, err)
	}
	result, err := app.Query(domain.QueryInput{
		ProfileID: session.ProfileID, Group: "project", Logstore: "app", Query: "error",
	})
	if err != nil || result.Total != 1 {
		t.Fatalf("Query() = %#v, %v", result, err)
	}
	history, err := app.QueryHistory(session.ProfileID, "project", "app")
	if err != nil || len(history) != 1 {
		t.Fatalf("QueryHistory() = %#v, %v", history, err)
	}
	bootstrap, err := app.Bootstrap()
	if err != nil || len(bootstrap.Profiles) != 1 {
		t.Fatalf("Bootstrap() = %#v, %v", bootstrap, err)
	}
	reconnected, err := app.ConnectSaved(session.ProfileID)
	if err != nil || reconnected.ProfileID != session.ProfileID {
		t.Fatalf("ConnectSaved() = %#v, %v", reconnected, err)
	}
	update := input
	update.Name = "production-renamed"
	update.AccessKey = ""
	update.SecretKey = ""
	if err := app.UpdateProfile(session.ProfileID, update); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteProfile(session.ProfileID); err != nil {
		t.Fatal(err)
	}
	bootstrap, err = app.Bootstrap()
	if err != nil || len(bootstrap.Profiles) != 0 {
		t.Fatalf("Bootstrap() after deletion = %#v, %v", bootstrap, err)
	}
}

func TestAppRejectsInvalidBoundaryInputs(t *testing.T) {
	app := newBoundaryApp(t)
	if _, err := app.Connect(domain.ConnectionInput{}); err == nil {
		t.Fatal("Connect() accepted invalid input")
	}
	if _, err := app.ConnectSaved(0); err == nil {
		t.Fatal("ConnectSaved() accepted invalid profile")
	}
	if err := app.UpdateProfile(0, domain.ConnectionInput{}); err == nil {
		t.Fatal("UpdateProfile() accepted invalid profile")
	}
	if err := app.DeleteProfile(0); err == nil {
		t.Fatal("DeleteProfile() accepted invalid profile")
	}
	if _, err := app.Query(domain.QueryInput{}); err == nil {
		t.Fatal("Query() accepted empty logstore")
	}
	if history, err := app.QueryHistory(0, "", ""); err != nil || len(history) != 0 {
		t.Fatalf("QueryHistory() = %#v, %v", history, err)
	}
	if err := app.SaveSettings(domain.Settings{Theme: "invalid"}); err == nil {
		t.Fatal("SaveSettings() accepted invalid settings")
	}
}
