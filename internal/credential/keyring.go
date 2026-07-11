package credential

import (
	"encoding/json"
	"fmt"

	keyring "github.com/zalando/go-keyring"
)

const serviceName = "LogGopher"

type Secret struct {
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
}

type Store interface {
	Save(profileID int64, secret Secret) error
	Get(profileID int64) (Secret, error)
	Delete(profileID int64) error
}

type KeyringStore struct{}

func NewKeyringStore() *KeyringStore { return &KeyringStore{} }

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

func (k *KeyringStore) Delete(profileID int64) error {
	err := keyring.Delete(serviceName, account(profileID))
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("delete credentials from system keychain: %w", err)
	}
	return nil
}

func account(profileID int64) string { return fmt.Sprintf("profile:%d", profileID) }
