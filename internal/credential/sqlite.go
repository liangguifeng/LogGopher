package credential

import (
	"errors"
	"fmt"

	"github.com/liangguifeng/LogGopher/internal/storage"
)

// SQLiteStore persists credentials in the same per-user database as connection metadata.
// A legacy store may be supplied to migrate credentials saved by earlier releases.
type SQLiteStore struct {
	store  *storage.Store
	legacy Store
}

// NewSQLiteStore creates the active credential store with an optional legacy fallback.
func NewSQLiteStore(store *storage.Store, legacy Store) *SQLiteStore {
	return &SQLiteStore{store: store, legacy: legacy}
}

// Save writes credentials into the profile row in SQLite.
func (s *SQLiteStore) Save(profileID int64, secret Secret) error {
	if err := s.store.SaveCredentials(profileID, secret.AccessKey, secret.SecretKey); err != nil {
		return fmt.Errorf("save credentials to sqlite: %w", err)
	}
	return nil
}

// Get loads SQLite credentials and lazily migrates credentials from the legacy store.
func (s *SQLiteStore) Get(profileID int64) (Secret, error) {
	accessKey, secretKey, err := s.store.Credentials(profileID)
	if err == nil {
		return Secret{AccessKey: accessKey, SecretKey: secretKey}, nil
	}
	if !errors.Is(err, storage.ErrCredentialsNotFound) || s.legacy == nil {
		return Secret{}, fmt.Errorf("read credentials from sqlite: %w", err)
	}
	secret, legacyErr := s.legacy.Get(profileID)
	if legacyErr != nil {
		return Secret{}, fmt.Errorf("read legacy credentials: %w", legacyErr)
	}
	if err := s.Save(profileID, secret); err != nil {
		return Secret{}, fmt.Errorf("migrate legacy credentials: %w", err)
	}
	_ = s.legacy.Delete(profileID)
	return secret, nil
}

// Delete removes SQLite credentials and best-effort cleans up the legacy store.
func (s *SQLiteStore) Delete(profileID int64) error {
	if err := s.store.DeleteCredentials(profileID); err != nil {
		return fmt.Errorf("delete credentials from sqlite: %w", err)
	}
	if s.legacy != nil {
		_ = s.legacy.Delete(profileID)
	}
	return nil
}
