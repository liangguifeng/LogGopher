package credential

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/storage"
)

type memoryLegacyStore struct {
	secrets map[int64]Secret
}

func (m *memoryLegacyStore) Save(profileID int64, secret Secret) error {
	m.secrets[profileID] = secret
	return nil
}

func (m *memoryLegacyStore) Get(profileID int64) (Secret, error) {
	secret, ok := m.secrets[profileID]
	if !ok {
		return Secret{}, errors.New("legacy credentials not found")
	}
	return secret, nil
}

func (m *memoryLegacyStore) Delete(profileID int64) error {
	delete(m.secrets, profileID)
	return nil
}

func TestSQLiteStoreRoundTrip(t *testing.T) {
	db, err := storage.OpenPath(filepath.Join(t.TempDir(), "credentials.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	profileID, err := db.SaveProfile(domain.ConnectionInput{AdapterID: "aliyun-sls", Name: "production"})
	if err != nil {
		t.Fatal(err)
	}
	store := NewSQLiteStore(db, nil)
	want := Secret{AccessKey: "test-ak", SecretKey: "test-sk"}
	if err := store.Save(profileID, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(profileID)
	if err != nil || got != want {
		t.Fatalf("Get() = %+v, %v; want %+v", got, err, want)
	}
	if err := store.Delete(profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(profileID); err == nil {
		t.Fatal("Get() returned deleted credentials")
	}
}

func TestSQLiteStoreMigratesLegacyCredentialsOnRead(t *testing.T) {
	db, err := storage.OpenPath(filepath.Join(t.TempDir(), "migration.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	profileID, err := db.SaveProfile(domain.ConnectionInput{AdapterID: "tencent-cls", Name: "legacy"})
	if err != nil {
		t.Fatal(err)
	}
	want := Secret{AccessKey: "legacy-ak", SecretKey: "legacy-sk"}
	legacy := &memoryLegacyStore{secrets: map[int64]Secret{profileID: want}}
	store := NewSQLiteStore(db, legacy)
	got, err := store.Get(profileID)
	if err != nil || got != want {
		t.Fatalf("Get() = %+v, %v; want %+v", got, err, want)
	}
	if _, ok := legacy.secrets[profileID]; ok {
		t.Fatal("legacy credentials were not removed after migration")
	}
	got, err = store.Get(profileID)
	if err != nil || got != want {
		t.Fatalf("second Get() = %+v, %v; want SQLite value %+v", got, err, want)
	}
}
