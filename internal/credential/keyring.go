package credential

import (
	"encoding/json"
	"fmt"

	keyring "github.com/zalando/go-keyring"
)

const serviceName = "LogGopher"

// Secret contains credentials stored by the operating system credential manager.
type Secret struct {
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
}

// Store defines the credential operations required by the application service.
type Store interface {
	// Save persists credentials for a profile.
	Save(profileID int64, secret Secret) error
	// Get retrieves credentials for a profile.
	Get(profileID int64) (Secret, error)
	// Delete removes credentials for a profile.
	Delete(profileID int64) error
}

// KeyringStore persists credentials in the native operating system keyring.
type KeyringStore struct{}

// NewKeyringStore creates an operating system backed credential store.
func NewKeyringStore() *KeyringStore { return &KeyringStore{} }

// Save writes credentials under the stable account derived from a profile ID.
func (k *KeyringStore) Save(profileID int64, secret Secret) error {
	payload, err := json.Marshal(secret)
	if err != nil {
		return fmt.Errorf("encode credentials: %w", err)
	}
	if err := keyring.Set(serviceName, account(profileID), string(payload)); err != nil {
		return fmt.Errorf("save credentials to system keychain: %w", err)
	}
	return nil
}

// Get loads credentials associated with a saved profile.
func (k *KeyringStore) Get(profileID int64) (Secret, error) {
	payload, err := keyring.Get(serviceName, account(profileID))
	if err != nil {
		return Secret{}, fmt.Errorf("read credentials from system keychain: %w", err)
	}
	var secret Secret
	if err := json.Unmarshal([]byte(payload), &secret); err != nil {
		return Secret{}, fmt.Errorf("decode credentials: %w", err)
	}
	return secret, nil
}

// Delete removes credentials associated with a saved profile.
func (k *KeyringStore) Delete(profileID int64) error {
	err := keyring.Delete(serviceName, account(profileID))
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("delete credentials from system keychain: %w", err)
	}
	return nil
}

func account(profileID int64) string { return fmt.Sprintf("profile:%d", profileID) }
