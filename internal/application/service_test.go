package application

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/liangguifeng/LogGopher/internal/adapter"
	"github.com/liangguifeng/LogGopher/internal/credential"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/storage"
)

type serviceAdapter struct {
	info       domain.AdapterInfo
	groups     []domain.LogGroup
	result     domain.QueryResult
	connectErr error
	queryErr   error
	connected  domain.ConnectionInput
	queried    domain.QueryInput
}

func (fake *serviceAdapter) Info() domain.AdapterInfo { return fake.info }
func (fake *serviceAdapter) Connect(_ context.Context, input domain.ConnectionInput) ([]domain.LogGroup, error) {
	fake.connected = input
	return fake.groups, fake.connectErr
}
func (fake *serviceAdapter) Query(_ context.Context, _ domain.ConnectionInput, input domain.QueryInput) (domain.QueryResult, error) {
	fake.queried = input
	return fake.result, fake.queryErr
}

type memoryCredentials struct {
	items   map[int64]credential.Secret
	saveErr error
	getErr  error
}

func (store *memoryCredentials) Save(id int64, secret credential.Secret) error {
	if store.saveErr != nil {
		return store.saveErr
	}
	store.items[id] = secret
	return nil
}
func (store *memoryCredentials) Get(id int64) (credential.Secret, error) {
	if store.getErr != nil {
		return credential.Secret{}, store.getErr
	}
	secret, ok := store.items[id]
	if !ok {
		return credential.Secret{}, errors.New("credential not found")
	}
	return secret, nil
}
func (store *memoryCredentials) Delete(id int64) error { delete(store.items, id); return nil }

func newServiceFixture(t *testing.T) (*Service, *serviceAdapter, *memoryCredentials) {
	t.Helper()
	database, err := storage.OpenPath(filepath.Join(t.TempDir(), "service.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	fake := &serviceAdapter{
		info:   domain.AdapterInfo{ID: "test-adapter", Name: "Test", Ready: true},
		groups: []domain.LogGroup{{Name: "group-a", Logstores: []string{"app"}}},
		result: domain.QueryResult{Total: 1, Entries: []domain.LogEntry{{Message: "ok"}}},
	}
	registry := adapter.DefaultRegistry()
	registry.Register(fake)
	credentials := &memoryCredentials{items: make(map[int64]credential.Secret)}
	return NewService(database, registry, credentials), fake, credentials
}

func testConnection() domain.ConnectionInput {
	return domain.ConnectionInput{
		AdapterID: "test-adapter", Name: "production", Endpoint: "https://example.com",
		AccessKey: "access", SecretKey: "secret",
	}
}

func TestServiceConnectQueryHistoryAndReconnect(t *testing.T) {
	service, fake, credentials := newServiceFixture(t)
	service.Start(context.Background())
	session, err := service.Connect(testConnection())
	if err != nil || session.ProfileID <= 0 || len(session.Groups) != 1 {
		t.Fatalf("Connect() = %#v, %v", session, err)
	}
	if credentials.items[session.ProfileID].SecretKey != "secret" {
		t.Fatalf("credentials = %#v", credentials.items)
	}
	query := domain.QueryInput{ProfileID: session.ProfileID, Group: "group-a", Logstore: "app", Query: "level:error"}
	result, err := service.Query(query)
	if err != nil || result.Total != 1 || fake.queried.Query != query.Query {
		t.Fatalf("Query() = %#v, %v", result, err)
	}
	history, err := service.QueryHistory(session.ProfileID, "group-a", "app")
	if err != nil || len(history) != 1 || history[0].Query != query.Query {
		t.Fatalf("QueryHistory() = %#v, %v", history, err)
	}
	reconnected, err := service.ConnectSaved(session.ProfileID)
	if err != nil || reconnected.ProfileID != session.ProfileID || fake.connected.AccessKey != "access" {
		t.Fatalf("ConnectSaved() = %#v, %v", reconnected, err)
	}
	bootstrap, err := service.Bootstrap()
	if err != nil || len(bootstrap.Profiles) != 1 || len(bootstrap.Adapters) != 3 {
		t.Fatalf("Bootstrap() = %#v, %v", bootstrap, err)
	}
}

func TestServiceRejectsUnknownExpiredAndProviderFailures(t *testing.T) {
	service, fake, credentials := newServiceFixture(t)
	unknown := testConnection()
	unknown.AdapterID = "missing"
	if _, err := service.Connect(unknown); err == nil {
		t.Fatal("Connect() accepted unknown adapter")
	}
	if _, err := service.Query(domain.QueryInput{ProfileID: 99}); err == nil {
		t.Fatal("Query() accepted expired session")
	}
	fake.connectErr = errors.New("provider unavailable")
	if _, err := service.Connect(testConnection()); !errors.Is(err, fake.connectErr) {
		t.Fatalf("Connect() error = %v", err)
	}
	fake.connectErr = nil
	credentials.saveErr = errors.New("keychain locked")
	if _, err := service.Connect(testConnection()); !errors.Is(err, credentials.saveErr) {
		t.Fatalf("Connect() credential error = %v", err)
	}
}

func TestQueryHistoryScope(t *testing.T) {
	if got := queryHistoryScope("", "app"); got != "app" {
		t.Fatalf("queryHistoryScope() = %q", got)
	}
	if got := queryHistoryScope(" project ", "app"); got != " project \x1fapp" {
		t.Fatalf("queryHistoryScope() = %q", got)
	}
}
