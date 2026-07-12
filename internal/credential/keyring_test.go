package credential

import (
	"errors"
	"testing"

	keyring "github.com/zalando/go-keyring"
)

func TestKeyringStoreRoundTrip(t *testing.T) {
	keyring.MockInit()
	store := NewKeyringStore()
	want := Secret{AccessKey: "test-ak", SecretKey: "test-sk"}
	if err := store.Save(42, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(42)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if err := store.Delete(42); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(42); err == nil {
		t.Fatal("expected deleted credentials to be unavailable")
	}
}

func TestKeyringStoreWrapsBackendErrors(t *testing.T) {
	backendErr := errors.New("keyring unavailable")
	keyring.MockInitWithError(backendErr)
	store := NewKeyringStore()
	if err := store.Save(1, Secret{}); !errors.Is(err, backendErr) {
		t.Fatalf("Save() error = %v", err)
	}
	if _, err := store.Get(1); !errors.Is(err, backendErr) {
		t.Fatalf("Get() error = %v", err)
	}
	if err := store.Delete(1); !errors.Is(err, backendErr) {
		t.Fatalf("Delete() error = %v", err)
	}
}
